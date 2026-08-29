// approval-notify (dsh-approval-notify) — DSH 审批 Windows 系统通知插件（Host 半体）。
// 当 DSH 发起审批请求时，在 Windows 弹出系统通知气泡；点击通知唤起桌面应用或
// 打开浏览器。唤起模式可在设置页（常规 → 审批通知）切换，持久化到
// $DSH_HOME/settings.yaml 的 approval-notify 命名空间。
//
// 设计要点（便于其它机器开箱即用）：
//  - 桌面应用路径自动探测（见 detectAppPath），可配置覆盖；
//  - GUI 地址自动取 webServer 真实监听端口（桌面封装以 --port 0 随机分配端口）；
//  - 审计日志默认关闭，配置 logFile 路径才写。
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const NS = 'approval-notify'
const FALLBACK_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const FALLBACK_URL = 'http://127.0.0.1:3080'
const DEFAULT_LOG = ''

// Audit log: disabled by default; set settings.approval-notify.logFile (or the
// JSON config file's logFile) to a path to write one line per notification.
let logFile = DEFAULT_LOG
const mark = (line) => {
  if (logFile === '') return
  try {
    appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\n')
  } catch {}
}

// Auto-detect the DeepSeek Harness desktop app executable. Config override wins.
function detectAppPath() {
  // 1) Derive from the running binary (desktop wrapper layout):
  //    <install>\DeepSeek Harness\resources\app\assets\dsh-node.exe
  //    -> app exe sits three levels up: <install>\DeepSeek Harness\DeepSeek Harness.exe
  try {
    const assets = dirname(process.execPath)
    const appDir = resolve(assets, '..', '..', '..')
    const candidate = join(appDir, 'DeepSeek Harness.exe')
    if (existsSync(candidate)) return candidate
  } catch {}
  // 2) Well-known install roots (Program Files / LOCALAPPDATA).
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
  for (const base of roots) {
    if (!base) continue
    const candidate = join(base, 'dsh', 'DeepSeek Harness', 'DeepSeek Harness.exe')
    if (existsSync(candidate)) return candidate
  }
  return ''
}

// Settings namespace schema: drives the Settings UI form and validation.
// appPath / url / logFile: empty string means "auto / off".
const Schema = z.object({
  launch: z.union(['app', 'browser']).default('app'),
  appPath: z.string().default(''),
  url: z.string().default(''),
  logFile: z.string().default(DEFAULT_LOG),
})

export default {
  // Host rows apply in parallel; wait for every hard dependency before apply().
  inject: ['subprocess', 'sessionTitle', 'sandboxPolicy', 'settings', 'webServer'],
  apply(ctx) {
    mark('apply-enter')
    const subprocess = ctx.get('subprocess')
    const sessionTitleService = ctx.get('sessionTitle')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const settings = ctx.get('settings')
    if (subprocess === undefined) {
      mark('SKIP: subprocess not available')
      return
    }

    // Register the settings namespace (Settings UI + persistence). Failure must
    // not kill the host boot: degrade to the JSON config file fallback.
    let settingsRegistered = false
    if (settings !== undefined) {
      try {
        settings.register(NS, Schema)
        settingsRegistered = true
        mark('settings-registered')
      } catch (error) {
        mark('settings-register-failed: ' + (error instanceof Error ? error.message : String(error)))
      }
    } else {
      mark('settings-service-missing')
    }

    let powershellExe
    const resolvePowerShell = async () => {
      if (powershellExe !== undefined) return powershellExe
      try {
        powershellExe = await subprocess.resolveExecutable('powershell.exe')
      } catch {
        powershellExe = FALLBACK_POWERSHELL
      }
      return powershellExe
    }

    const psQuote = (value) => "'" + String(value).replace(/'/g, "''") + "'"

    const truncate = (value, max) => {
      const text = String(value)
      return text.length <= max ? text : text.slice(0, max - 1) + '…'
    }

    // The desktop wrapper launches dsh with --port 0 (OS-assigned), so the GUI
    // port is dynamic. Read the real bound port from the webServer service.
    const resolveLiveUrl = () => {
      try {
        const ws = ctx.get('webServer')
        if (ws !== undefined && typeof ws.port === 'number' && ws.port > 0) {
          return 'http://127.0.0.1:' + String(ws.port)
        }
      } catch {}
      return FALLBACK_URL
    }

    // Read raw config: settings namespace (UI) wins, else the JSON config file,
    // else built-in defaults. Empty appPath/url/logFile mean "auto / off".
    const readConfig = () => {
      let cfg = { launch: 'app', appPath: '', url: '', logFile: DEFAULT_LOG }
      const fileCandidates = [join(DSH_HOME, 'approval-notify.json')]
      if (sandboxPolicy !== undefined) {
        const root = sandboxPolicy.workspaceRoot
        if (typeof root === 'string' && root !== '') fileCandidates.push(join(root, 'approval-notify.json'))
      }
      for (const path of fileCandidates) {
        try {
          if (!existsSync(path)) continue
          const parsed = JSON.parse(readFileSync(path, 'utf8'))
          cfg = {
            launch: parsed.launch === 'browser' ? 'browser' : 'app',
            appPath: typeof parsed.appPath === 'string' ? parsed.appPath : '',
            url: typeof parsed.url === 'string' ? parsed.url : '',
            logFile: typeof parsed.logFile === 'string' ? parsed.logFile : DEFAULT_LOG,
          }
          break
        } catch {}
      }
      try {
        if (settingsRegistered && settings !== undefined) {
          const value = settings.get(NS)
          if (value !== undefined && typeof value === 'object' && value !== null) {
            cfg = {
              launch: value.launch === 'browser' ? 'browser' : 'app',
              appPath: typeof value.appPath === 'string' ? value.appPath : cfg.appPath,
              url: typeof value.url === 'string' ? value.url : cfg.url,
              logFile: typeof value.logFile === 'string' ? value.logFile : cfg.logFile,
            }
          }
        }
      } catch {}
      return cfg
    }

    // Resolve defaults: appPath auto-detect, url live, launch falls back to
    // browser when app mode has no resolvable app executable.
    const launchConfig = () => {
      const cfg = readConfig()
      logFile = cfg.logFile || DEFAULT_LOG
      const appPath = cfg.appPath !== '' ? cfg.appPath : detectAppPath()
      const url = cfg.url !== '' ? cfg.url : resolveLiveUrl()
      const launch = cfg.launch === 'app' && appPath === '' ? 'browser' : cfg.launch
      return { launch, appPath, url }
    }

    const notify = async (req) => {
      if (req.signal !== undefined && req.signal.aborted === true) return

      // Compact summary so the balloon stays short instead of filling up.
      const singleLine = (value) => String(value).replace(/\s+/g, ' ').trim()
      const toolName = req.toolName
      const reason = req.reason
      const session = req.agent !== undefined ? req.agent.session : undefined

      let body = '工具 ' + String(toolName) + ' 需要审批'
      const reasonText = typeof reason === 'string' ? singleLine(reason) : ''
      if (reasonText !== '') body += '：' + truncate(reasonText, 90)
      if (session !== undefined) {
        let title
        try {
          title = sessionTitleService.get(session).title
        } catch {}
        if (typeof title === 'string' && title !== '') {
          body += '\n会话：' + truncate(singleLine(title), 26)
        }
      }

      const config = launchConfig()
      const clickCommand = config.launch === 'app'
        ? 'Start-Process -FilePath ' + psQuote(config.appPath)
        : 'Start-Process ' + psQuote(config.url)

      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '$tip = New-Object System.Windows.Forms.NotifyIcon',
        '$tip.Icon = $null',
        'try { $tip.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon(' + psQuote(config.appPath) + ') } catch { $tip.Icon = [System.Drawing.SystemIcons]::Information }',
        'if ($null -eq $tip.Icon) { $tip.Icon = [System.Drawing.SystemIcons]::Information }',
        '$tip.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info',
        '$tip.BalloonTipTitle = ' + psQuote(truncate('DSH 需要审批', 64)),
        '$tip.BalloonTipText = ' + psQuote(truncate(body, 160)),
        '$tip.Visible = $true',
        '$script:closed = $false',
        '$tip.add_BalloonTipClosed({ $script:closed = $true })',
        '$tip.add_BalloonTipClicked({ ' + clickCommand + ' })',
        '$tip.ShowBalloonTip(15000)',
        '$deadline = (Get-Date).AddSeconds(30)',
        'while (-not $script:closed -and (Get-Date) -lt $deadline) {',
        '  [System.Windows.Forms.Application]::DoEvents()',
        '  Start-Sleep -Milliseconds 100',
        '}',
        '$tip.Dispose()',
      ].join('\n')

      const exe = await resolvePowerShell()
      const slash = exe.lastIndexOf('\\')
      const cwd = slash > 0 ? exe.slice(0, slash) : 'C:\\Windows'

      const spec = {
        argv: [exe, '-NoProfile', '-NonInteractive', '-Sta', '-WindowStyle', 'Hidden', '-Command', script],
        cwd,
        env: {},
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
        graceMs: 5000,
      }
      if (req.signal !== undefined) spec.signal = req.signal

      try {
        const handle = subprocess.spawn(spec)
        handle.done.catch(() => {})
        console.log('approval-notify: balloon queued for tool ' + String(toolName) + ' (launch=' + config.launch + ')')
        mark('[notify] tool=' + String(toolName) + ' launch=' + config.launch + ' url=' + config.url + ' spawned')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('approval-notify: spawn failed', error)
        mark('[notify] tool=' + String(toolName) + ' SPAWN-FAILED: ' + message)
      }
    }

    try {
      ctx.on('approval/request', (req, next) => {
        void notify(req).catch((error) => {
          console.error('approval-notify: notification failed', error)
          mark('[notify] FAILED: ' + (error instanceof Error ? error.message : String(error)))
        })
        return next()
      }, { prepend: true })
      mark('listener-registered')
    } catch (error) {
      mark('LISTENER-REGISTER-ERROR: ' + (error instanceof Error ? error.message : String(error)))
      throw error
    }

    console.log('approval-notify: permanent dual-face plugin installed')
    mark('apply-done')
  },
}
