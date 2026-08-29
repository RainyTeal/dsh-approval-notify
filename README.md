# approval-notify（dsh-approval-notify）

DSH（DeepSeek Harness）审批 **Windows 系统通知**插件。当 DSH 需要你审批某个操作时，在 Windows 右下角弹出系统通知气泡；**点击通知**即唤起桌面应用或打开浏览器，直达审批界面。

唤起方式（桌面应用 / 浏览器）可在 **设置 → 常规 → 审批通知** 一行中直接切换，写入 `settings.yaml`，即时生效、无需重启。

## 特性

- 审批时弹出系统通知气泡（标题、工具名、简短原因、会话标题）
- 点击气泡 → 唤起桌面应用（自动聚焦已有窗口）或打开浏览器
- 唤起模式可在设置页切换，持久化、即时生效
- GUI 地址自动取当前真实监听端口（兼容桌面封装 `--port 0` 随机端口）
- 桌面应用路径自动探测，也支持配置覆盖
- 可选审计日志（默认关闭）

## 适用平台

- Windows 7+（通知用 PowerShell + `NotifyIcon.ShowBalloonTip`，无需额外安装）
- 需要 DeepSeek Harness 桌面应用（用于"唤起桌面应用"模式）或仅浏览器

## 安装

### 目前阶段建议采用手动安装

1. 把本包目录复制到 profile 的 plugins 目录下，例如：
   ```
   ~/.dsh/profiles/web/plugins/approval-notify/
   ```
2. 在 profile 的 `node_modules` 下建立软链（junction），使包名可被解析：
   ```
   # 以管理员 PowerShell 运行
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\web\node_modules\approval-notify" `
     -Target "$env:USERPROFILE\.dsh\profiles\web\plugins\approval-notify"
   ```
3. 在 profile 组合 `~/.dsh/profiles/web/cordis.patch.yml` 增加一行：
   ```yaml
   - insert:
       - id: approval-notify
         name: 'approval-notify'
   ```
4. 重启 DeepSeek Harness。

## 配置

### 设置页（首选）

**设置 → 常规 → 审批通知**：点「桌面应用」或「浏览器」切换点击通知后的唤起方式。

底层持久化到 `$DSH_HOME/settings.yaml`：

```yaml
approval-notify:
  launch: app            # app | browser
  # appPath: ""          # 留空=自动探测桌面应用；填绝对路径则覆盖
  # url: ""              # 留空=自动取当前 GUI 地址；填 http://... 则覆盖
  # logFile: ""          # 留空=关闭审计日志；填路径则每次通知写一行
```

### JSON 配置文件（回退）

当设置命名空间不可用时，插件会读取 `$DSH_HOME/approval-notify.json` 或工作区下的 `approval-notify.json`：

```json
{ "launch": "app", "appPath": "", "url": "", "logFile": "" }
```

优先级：设置命名空间 > JSON 配置文件 > 内置默认（自动探测）。

## 桌面应用路径探测

`launch: app` 时按以下顺序定位 DeepSeek Harness 桌面应用可执行文件：

1. 由当前运行进程推导（桌面封装布局 `...\resources\app\assets\dsh-node.exe` → 上三级 `DeepSeek Harness.exe`）；
2. 常见安装根（`Program Files`、`Program Files (x86)`、`LOCALAPPDATA` 下的 `dsh\DeepSeek Harness\`）；
3. 配置 `appPath` 显式覆盖（优先级最高）。

找不到时自动回退为浏览器模式。

## 架构

双面 Cordis 插件：

| 半体 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.mjs` | 监听 `approval/request`（`prepend: true`，只观察不回答，`return next()` 委托给浏览器应答者）；注册 `approval-notify` 设置命名空间；spawn PowerShell 弹气泡 |
| Client | `client.js` | 在 `settings.general.item` 渲染「审批通知」切换行，经 `settingsScope` 读写命名空间 |

- 通知通过 `subprocess` 服务 spawn `powershell.exe -Sta -WindowStyle Hidden`，用 `NotifyIcon.ShowBalloonTip` 弹气泡，`DoEvents` 消息泵保活，点击用 `Start-Process` 唤起应用/浏览器，30 秒兜底自清理。
- 进程图标取自桌面应用可执行文件（`Icon::ExtractAssociatedIcon`）。

## 排障

- **通知不弹出**：看宿主日志（`console`），确认 `approval/request` 到达；配置 `logFile` 后触发一次审批查看写入。
- **点击后连接被拒**：GUI 端口是随机分配的；不要写死端口，让 `url` 留空（自动取真实端口）。
- **`ERR_MODULE_NOT_FOUND`**：junction/软链未建立或路径不对；确认 `node_modules/approval-notify` 指向插件包目录。

## License

MIT © 2026
