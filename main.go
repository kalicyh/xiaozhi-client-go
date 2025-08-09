package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	
	if err := wails.Run(&options.App{
		Title:  "xiaozhi_client-go",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{ Assets: assets },
		OnStartup: app.startup,
		Bind: []interface{}{ app },
		// 自定义窗口设置
		Frameless: true,
		CSSDragProperty: "-webkit-app-region",
		CSSDragValue: "drag",
	}); err != nil { println("Error:", err.Error()) }
}
