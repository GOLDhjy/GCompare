# GCompare

[![Build](https://github.com/GOLDhjy/GCompare/actions/workflows/release.yml/badge.svg)](https://github.com/GOLDhjy/GCompare/actions/workflows/release.yml)
[![Release](https://img.shields.io/github/v/release/GOLDhjy/GCompare)](https://github.com/GOLDhjy/GCompare/releases)
[![Stars](https://img.shields.io/github/stars/GOLDhjy/GCompare)](https://github.com/GOLDhjy/GCompare/stargazers)


中文为主：这是中文版 README。English version: [README_EN.md](README_EN.md)

GCompare 是一个基于 Tauri v2 的跨平台文本/文件差异对比工具，目标是做一个轻量、可离线、面向开发者的对比器。

## 功能
- 文本差异对比（Monaco diffEditor）
- 本地文件对比（选择文件/拖拽文件）
- 系统“打开方式”关联（常见文本/代码扩展名）
- Inline / Side-by-side 切换
- 未来：Git 单文件历史对比（基于 git CLI）

![GCompare v0.1.0](./public/Images/v0.1.0.png)

## 下载
请前往 Release 页面下载：  
https://github.com/GOLDhjy/GCompare/releases

## 使用
- 打开左/右文件：点击按钮或使用快捷键
- 拖拽文件：拖到左/右区域即可
- 系统打开：将文件“用 GCompare 打开”
- 视图切换：点击 Inline 开关

## 快捷键
- 左侧打开：Ctrl/Cmd + O
- 右侧打开：Ctrl/Cmd + Shift + O
- 视图切换：Ctrl/Cmd + 1 / 2

## 开发
环境要求：Node.js、Rust、Tauri 依赖

```bash
npm install
npm run tauri dev
```

## 路线图

- 复制粘贴文本对比
- 双文件对比
- Git 单文件历史对比

## 许可证
MIT License
