const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("ieonDesktop", { platform: process.platform });
