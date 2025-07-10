// API 配置文件
const CONFIG = {
    // 開發環境（本地）
    development: {
        API_BASE_URL: 'http://localhost:5000/api'
    },
    
    // 生產環境（GitHub Pages + 固定 IP）
    production: {
        API_BASE_URL: 'https://203.204.180.34:5000/api'
    },
    
    // Render 雲端環境
    render: {
       API_BASE_URL: 'https://pos2-7bcp.onrender.com/api'  // 替換為您的 Render URL  // 替換為您的 Render URL
    },
    
    // 其他雲端服務
    cloud: {
        API_BASE_URL: 'https://your-app.azurewebsites.net/api'  // 替換為您的雲端 URL
    }
};

// 自動偵測環境
function getEnvironment() {
    const hostname = window.location.hostname;
    
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'development';
    } else if (hostname.includes('github.io')) {
        // GitHub Pages 使用 Render API
        return 'render';
    } else if (hostname.includes('onrender.com')) {
        return 'render';
    } else {
        return 'cloud';
    }
}

// 取得當前環境的配置
function getConfig() {
    const env = getEnvironment();
    return CONFIG[env];
}

// 匯出配置供其他文件使用
window.APP_CONFIG = getConfig(); 
