# 小智客户端 Go 版本

基于 Wails v2 开发的跨平台小智语音助手客户端，支持 WebSocket 和 MQTT+UDP 双协议通信。

## 🚀 功能特性

### 📡 双协议支持
- **WebSocket 协议**：简单直接的全双工通信
- **MQTT+UDP 协议（未完成）**：控制消息与音频数据分离，更高的实时性

### 🔐 灵活的身份验证
- **Header 方式**：通过 `Authorization` 头携带 Bearer Token
- **Query 参数**：通过 `access_token` 或 `token` 参数携带
- **手动选择**：用户可在界面中自由切换认证方式

### 🎵 音频处理
- **Opus 编码**：高质量低延迟的音频压缩
- **实时传输**：支持实时语音输入输出
- **多协议版本（未完成）**：支持不同的二进制协议格式

### 🛠️ 设备管理
- **OTA 自动获取**：支持从服务器自动获取 WebSocket 连接信息
- **配置持久化**：SQLite 数据库存储连接配置
- **设备标识**：统一的设备 ID 管理

### 🖥️ 响应式界面
- **窗口状态检测**：自动检测全屏/大窗口状态
- **动态缩放**：界面元素根据窗口大小自动缩放
- **实时状态**：连接状态、录音状态的实时显示

## 🏗️ 技术架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React 前端    │    │   Wails 桥接    │    │    Go 后端      │
│                 │    │                 │    │                 │
│ - 用户界面      │◄──►│ - JS/Go 通信    │◄──►│ - WebSocket     │
│ - 配置管理      │    │ - 事件传递      │    │ - MQTT 客户端   │
│ - 状态显示      │    │ - 窗口控制      │    │ - 音频处理      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                       │
                              ┌────────────────────────┼────────────────────────┐
                              │                        │                        │
                    ┌─────────▼─────────┐   ┌─────────▼─────────┐   ┌─────────▼─────────┐
                    │   WebSocket 传输  │   │   MQTT 控制通道   │   │   UDP 音频通道    │
                    │                   │   │                   │   │                   │
                    │ - 全双工通信      │   │ - 控制消息        │   │ - 实时音频        │
                    │ - JSON + 二进制   │   │ - 状态同步        │   │ - 加密传输        │
                    └───────────────────┘   └───────────────────┘   └───────────────────┘
```

## 📦 项目结构

```
xiaozhi-client-go/
├── app.go                     # 主应用入口，Wails 绑定
├── main.go                    # 程序入口点
├── go.mod                     # Go 模块定义
├── wails.json                 # Wails 项目配置
├── 
├── frontend/                  # React 前端
│   ├── src/
│   │   ├── App.jsx           # 主界面组件
│   │   ├── App.css           # 样式文件，包含响应式设计
│   │   └── main.jsx          # React 入口
│   ├── package.json          # 前端依赖
│   └── index.html            # HTML 模板
├── 
├── internal/                  # 内部模块
│   ├── client/               # 客户端核心
│   │   ├── client.go         # 主客户端实现
│   │   ├── config.go         # 配置结构体
│   │   └── types.go          # 消息类型定义
│   │   
│   ├── transport/            # 传输层实现
│   │   ├── websocket.go      # WebSocket 传输
│   │   ├── mqtt.go          # MQTT 控制通道
│   │   └── udp_audio.go     # UDP 音频通道
│   │   
│   ├── store/               # 数据存储
│   │   ├── sqlite.go        # SQLite 数据库
│   │   └── config_store.go  # 配置持久化
│   │   
│   └── audio/               # 音频处理
│       └── capture/         # 音频采集
├── 
├── docs/                     # 协议文档
│   ├── websocket.md         # WebSocket 协议规范
│   └── mqtt-udp.md          # MQTT+UDP 协议规范
├── 
└── build/                    # 构建配置
    ├── windows/             # Windows 平台配置
    ├── darwin/              # macOS 平台配置
    └── appicon.png          # 应用图标
```

## 🛠️ 开发环境

### 前置要求

- **Go 1.23+**：后端开发语言
- **Node.js 16+**：前端开发环境
- **Wails CLI v2.10.2+**：桌面应用框架

### 安装 Wails CLI

```bash
# 安装 Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# 验证安装
wails doctor
```

### 克隆项目

```bash
git clone https://github.com/kalicyh/xiaozhi-client-go.git
cd xiaozhi-client-go
```

### 安装依赖

```bash
# 安装前端依赖
cd frontend
npm install
cd ..

# 下载 Go 依赖
go mod tidy
```

## 🚀 运行项目

### 开发模式

```bash
# 启动开发服务器（热重载）
wails dev
```

开发服务器会自动：
- 启动 Go 后端
- 启动 Vite 前端开发服务器
- 打开桌面应用窗口
- 提供浏览器访问地址（通常是 http://localhost:34115）

### 生产构建

```bash
# 构建生产版本
wails build

# 构建结果位于 build/bin/ 目录
```

### 构建选项

```bash
# 仅构建，不打包
wails build -clean

# 跳过前端构建（前端已构建）
wails build -s

# 构建并压缩
wails build -upx
```

## 📋 使用说明

### 基本配置

1. **选择协议**：在界面上选择 "WebSocket" 或 "MQTT + UDP"
2. **配置连接**：
   - WebSocket：可使用 OTA 自动获取或手动输入 URL
   - MQTT：配置 Broker 地址、主题等信息
3. **设置认证**：
   - 启用/禁用 Token 认证
   - 选择 Token 携带方式（Header/Query参数）
4. **点击连接**：建立与服务器的连接

### OTA 自动配置

当使用 WebSocket 协议且启用 OTA 时：

1. 配置 OTA URL（默认：`https://api.tenclass.net/xiaozhi/ota/`）
2. 编辑 POST 请求体（JSON 格式），包含设备信息
3. 客户端会自动请求服务器获取 WebSocket 连接信息

### Token 认证方式

- **Header Authorization**：`Authorization: Bearer <token>`
- **Query参数 access_token**：`wss://host/ws?access_token=<token>`
- **Query参数 token**：`wss://host/ws?token=<token>`

### 界面自适应

应用支持响应式设计：
- **普通窗口**：标准界面布局
- **大窗口**（≥1200px 宽）：界面元素按比例放大 1.2 倍
- **全屏模式**：界面元素按比例放大 1.5 倍

## 🔧 配置说明

### 连接配置

```go
type Config struct {
    // 协议版本
    ProtocolVersion int    `json:"protocol_version"`
    
    // WebSocket 配置
    WebsocketURL string   `json:"websocket_url"`
    UseOTA       bool     `json:"use_ota"`
    OTAURL       string   `json:"ota_url"`
    OTABody      string   `json:"ota_body"`
    
    // 认证配置
    EnableToken bool      `json:"enable_token"`
    AuthToken   string    `json:"auth_token"`
    TokenMethod string    `json:"token_method"` // "header", "query_access_token", "query_token"
    
    // 设备标识
    DeviceID    string    `json:"device_id"`
    ClientID    string    `json:"client_id"`
    
    // MQTT 配置
    MQTTBroker        string `json:"mqtt_broker"`
    MQTTUsername      string `json:"mqtt_username"`
    MQTTPassword      string `json:"mqtt_password"`
    MQTTPublishTopic  string `json:"mqtt_publish_topic"`
    MQTTSubscribeTopic string `json:"mqtt_subscribe_topic"`
    
    // 音频配置
    Audio AudioParams `json:"audio"`
    
    // 超时配置
    HelloTimeout time.Duration `json:"hello_timeout"`
}
```

### 音频参数

```go
type AudioParams struct {
    Format        string `json:"format"`         // "opus"
    SampleRate    int    `json:"sample_rate"`    // 16000
    Channels      int    `json:"channels"`       // 1
    FrameDuration int    `json:"frame_duration"` // 60 (ms)
}
```

## 📖 协议文档

详细的通信协议请参考：

- [WebSocket 协议规范](docs/websocket.md) - 完整的 WebSocket 通信协议文档
- [MQTT+UDP 协议规范](docs/mqtt-udp.md) - MQTT 控制 + UDP 音频的混合协议

## 🔍 故障排除

### 常见问题

1. **Wails CLI 未找到**
   ```bash
   # 确保 Go bin 目录在 PATH 中
   go env GOPATH
   export PATH=$PATH:$(go env GOPATH)/bin
   ```

2. **前端构建失败**
   ```bash
   # 清理并重新安装依赖
   cd frontend
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Go 模块下载失败**
   ```bash
   # 设置代理（中国大陆）
   go env -w GOPROXY=https://goproxy.cn,direct
   go mod tidy
   ```

4. **连接服务器失败**
   - 检查网络连接
   - 验证服务器地址和端口
   - 确认 Token 有效性
   - 查看控制台错误信息

### 调试模式

开发模式下，应用会输出详细的调试信息：

```bash
# 查看连接过程
ws open: url=wss://host/ws?access_token=***; headers=map[...]; token=query:access_token

# 查看握手消息
ws hello payload={"type":"hello","version":1,...}
```

## 🤝 贡献指南

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [Wails](https://wails.io/) - 优秀的 Go + Web 前端框架
- [React](https://reactjs.org/) - 用户界面构建库
- [Vite](https://vitejs.dev/) - 快速的前端构建工具
- [Gorilla WebSocket](https://github.com/gorilla/websocket) - Go WebSocket 实现
- [Eclipse Paho MQTT](https://github.com/eclipse/paho.mqtt.golang) - Go MQTT 客户端

---

**小智客户端** - 让语音交互更简单 🎙️✨
