const express = require('express');
const cors = require('cors');
const sql = require('mssql');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// 中間件設定
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SQL Server 連線設定
const dbConfig = {
    server: process.env.DB_SERVER || '203.204.180.34',
    port: parseInt(process.env.DB_PORT) || 1433,
    database: process.env.DB_DATABASE || 'pos_system',
    user: process.env.DB_USERNAME || 'lucas',
    password: process.env.DB_PASSWORD || 'Vivi097398',
    options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
        requestTimeout: 30000,
        connectionTimeout: 30000
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// 建立連線池
let poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
        console.log('✅ 已連接到 SQL Server');
        return pool;
    })
    .catch(err => {
        console.error('❌ 資料庫連線失敗:', err);
        process.exit(1);
    });

// 健康檢查 API
app.get('/api/health', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT 1 as test');
        
        res.json({
            status: 'healthy',
            database: 'connected',
            server: dbConfig.server + ':' + dbConfig.port,
            message: '系統正常運行',
            platform: 'render-nodejs',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('健康檢查失敗:', err);
        res.status(500).json({
            status: 'error',
            database: 'disconnected',
            message: '資料庫連線失敗'
        });
    }
});

// 取得菜單 API
app.get('/api/menu', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT MenuId, Name, Price, Category, Note, Enabled, Image, OrderLimit
            FROM Menu 
            WHERE Enabled = 1
            ORDER BY Category, Name
        `);
        
        const menuItems = result.recordset.map(row => ({
            id: row.MenuId,
            name: row.Name,
            price: parseFloat(row.Price) || 0,
            category: row.Category || '',
            note: row.Note || '',
            enabled: Boolean(row.Enabled),
            image: row.Image || '',
            orderLimit: row.OrderLimit || 0
        }));
        
        res.json(menuItems);
    } catch (err) {
        console.error('取得菜單失敗:', err);
        res.status(500).json({ error: '取得菜單失敗' });
    }
});

// 取得熱門商品 API
app.get('/api/hot-items', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT TOP 5 m.MenuId, m.Name, m.Price, COUNT(oi.MenuId) as OrderCount
            FROM Menu m
            LEFT JOIN OrderItems oi ON m.MenuId = oi.MenuId
            WHERE m.Enabled = 1
            GROUP BY m.MenuId, m.Name, m.Price
            ORDER BY OrderCount DESC, m.Name
        `);
        
        const hotItems = result.recordset.map(row => ({
            id: row.MenuId,
            name: row.Name,
            price: parseFloat(row.Price) || 0,
            orderCount: row.OrderCount || 0
        }));
        
        res.json(hotItems);
    } catch (err) {
        console.error('取得熱門商品失敗:', err);
        res.status(500).json({ error: '取得熱門商品失敗' });
    }
});

// 建立訂單 API
app.post('/api/orders', async (req, res) => {
    const transaction = new sql.Transaction(await poolPromise);
    
    try {
        await transaction.begin();
        
        const { orderId, dineType, totalAmount, tableNumber, takeoutNumber, notes, items } = req.body;
        
        // 插入訂單
        const orderRequest = new sql.Request(transaction);
        const orderResult = await orderRequest
            .input('orderId', sql.VarChar, orderId)
            .input('dineType', sql.VarChar, dineType || '')
            .input('status', sql.VarChar, 'pending')
            .input('totalAmount', sql.Decimal, totalAmount || 0)
            .input('tableNumber', sql.VarChar, tableNumber || '')
            .input('takeoutNumber', sql.VarChar, takeoutNumber || '')
            .input('notes', sql.NVarChar, notes || '')
            .query(`
                INSERT INTO Orders (OrderId, DineType, Status, TotalAmount, TableNumber, TakeoutNumber, Notes, CreateTime)
                VALUES (@orderId, @dineType, @status, @totalAmount, @tableNumber, @takeoutNumber, @notes, GETDATE())
            `);
        
        // 使用 OrderId 作為關聯鍵
        const dbOrderId = orderId;
        
        // 插入訂單項目
        if (items && items.length > 0) {
            for (const item of items) {
                const itemRequest = new sql.Request(transaction);
                
                // 根據商品名稱查詢 MenuId
                const menuResult = await itemRequest
                    .input('itemName', sql.VarChar, item.name)
                    .query(`SELECT MenuId FROM Menu WHERE Name = @itemName`);
                
                if (menuResult.recordset.length > 0) {
                    const menuId = menuResult.recordset[0].MenuId;
                    
                    // 插入訂單項目
                    const insertRequest = new sql.Request(transaction);
                    await insertRequest
                        .input('orderId', sql.VarChar, dbOrderId)
                        .input('menuId', sql.Int, menuId)
                        .input('quantity', sql.Int, item.quantity || 0)
                        .input('price', sql.Decimal, item.price || 0)
                        .query(`
                            INSERT INTO OrderItems (OrderId, MenuId, Quantity, Price)
                            VALUES (@orderId, @menuId, @quantity, @price)
                        `);
                } else {
                    console.log(`警告：找不到商品 "${item.name}" 的 MenuId`);
                }
            }
        }
        
        await transaction.commit();
        
        res.json({
            success: true,
            orderId: orderId,
            message: '訂單建立成功'
        });
        
    } catch (err) {
        await transaction.rollback();
        console.error('建立訂單失敗:', err);
        res.status(500).json({ error: '建立訂單失敗' });
    }
});

// 取得訂單列表 API
app.get('/api/orders', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT OrderId, DineType, Status, TotalAmount, TableNumber, TakeoutNumber, Notes, CreateTime
            FROM Orders
            ORDER BY CreateTime DESC
        `);
        
        const orders = result.recordset.map(row => ({
            orderId: row.OrderId,
            dineType: row.DineType,
            status: row.Status,
            totalAmount: parseFloat(row.TotalAmount) || 0,
            tableNumber: row.TableNumber || '',
            takeoutNumber: row.TakeoutNumber || '',
            notes: row.Notes || '',
            timestamp: row.CreateTime ? row.CreateTime.toISOString() : null
        }));
        
        res.json(orders);
    } catch (err) {
        console.error('取得訂單失敗:', err);
        res.status(500).json({ error: '取得訂單失敗' });
    }
});

// 取得已使用的訂單號碼 API
app.get('/api/used-order-numbers', async (req, res) => {
    try {
        const { dineType, dateStr } = req.query;
        
        const pool = await poolPromise;
        const result = await pool.request()
            .input('dineType', sql.VarChar, dineType)
            .input('dateStr', sql.VarChar, dateStr + '%')
            .query(`
                SELECT OrderId
                FROM Orders
                WHERE DineType = @dineType 
                AND OrderId LIKE @dateStr
                ORDER BY OrderId
            `);
        
        const usedNumbers = [];
        result.recordset.forEach(row => {
            const orderId = row.OrderId;
            if (orderId) {
                // 從訂單ID中提取數字部分
                // 例如: "20250711-T001" -> 1
                const match = orderId.match(/-[DT](\d{3})$/);
                if (match) {
                    usedNumbers.push(parseInt(match[1], 10));
                }
            }
        });
        
        res.json(usedNumbers);
        
    } catch (err) {
        console.error('取得已使用訂單號碼失敗:', err);
        res.status(500).json({ error: '取得已使用訂單號碼失敗' });
    }
});

// 首頁
app.get('/', (req, res) => {
    res.json({
        message: '餐廳點餐系統 API',
        platform: 'Node.js + Express',
        status: 'running',
        endpoints: [
            '/api/health',
            '/api/menu',
            '/api/hot-items',
            '/api/orders'
        ],
        version: '1.0.0'
    });
});

// 錯誤處理中間件
app.use((err, req, res, next) => {
    console.error('伺服器錯誤:', err);
    res.status(500).json({ error: '內部伺服器錯誤' });
});

// 404 處理
app.use((req, res) => {
    res.status(404).json({ error: '找不到請求的資源' });
});

// 啟動伺服器
app.listen(PORT, '0.0.0.0', () => {
    console.log('=' * 60);
    console.log('      餐廳點餐系統 API 服務器 (Node.js)');
    console.log('=' * 60);
    console.log(`🚀 服務器運行在端口: ${PORT}`);
    console.log(`🔗 資料庫: ${dbConfig.server}:${dbConfig.port}`);
    console.log(`📋 API 文件: http://localhost:${PORT}/`);
    console.log('=' * 60);
});

// 優雅關閉
process.on('SIGINT', async () => {
    console.log('📴 正在關閉伺服器...');
    try {
        const pool = await poolPromise;
        await pool.close();
        console.log('✅ 資料庫連線已關閉');
    } catch (err) {
        console.error('❌ 關閉資料庫連線時發生錯誤:', err);
    }
    process.exit(0);
}); 