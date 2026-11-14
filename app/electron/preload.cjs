const { contextBridge, ipcRenderer } = require("electron");

// focus: 알림을 누르면 이어온 창을 앞으로(화면 쪽에서는 창을 앞으로 가져올 수 없어서)
contextBridge.exposeInMainWorld("ieonDesktop", { platform: process.platform, focus: () => ipcRenderer.send("ieon:focus") });
