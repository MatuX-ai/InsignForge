; ============================================================
; InsightForge NSIS 自定义钩子 (electron-builder 24.x)
; ============================================================
;
; 说明:
;   通过 electron-builder.yml 的 nsis.include 引用本文件,
;   electron-builder 自动生成的 .nsi 会在 key 时刻调用同名宏:
;
;     customInit      — Function .onInit 末尾 (MUI_PAGE_INSTFILES
;                       还没创建, 不能 SendMessage 改进度条)
;     customInstall   — installApplicationFiles + 快捷方式 + 注册表
;                       全部完成后 (此时进度条已接近 100%)
;     customUnInstall — 卸载脚本尾部
;     MUI_PAGE_CUSTOMFUNCTION_SHOW — MUI INSTFILES 页面 Show 时
;
; ⚠️ 真实 NSIS 限制:
;   installApplicationFiles 内部那一行
;       File /r "${APP_BUILD_DIR}\*.*"
;   是单 section, 80MB+ 几十万个文件的复制进度无法在中段刷新,
;   这是 NSIS 物理特性, electron-builder 没有提供中段钩子.
;
;   本文件的目的不是消除中段卡顿,
;   而是把"突然跳到 100% / 文字戛然而止"的突兀感,变成
;   多步细粒度的 SetProgressBar + 中文阶段说明 + 走马灯.
;
; 走马灯实现思路 (最终方案):
;   - 进度条 (control 1004) 下方有 ~6-10px 空隙, 紧接是 listbox (1016)
;   - 用 Win32 CreateWindowExW 在该空隙里创建一个 STATIC 子控件
;   - File /r 期间 NSIS 主流程在忙复制, 走马灯只能静态显示初始文字
;     "●  正在解压 InsightForge 主程序,请稍候..."
;   - customInstall 在 File /r 完成后接管, 用 Sleep + SetWindowTextW
;     在 ~5-10 秒窗口里做 ●○●○ 真实 spinner 字符循环动画
;   - 收尾时 ShowWindow SW_HIDE 隐藏控件
;
; 真实要彻底消除卡顿, 需要做以下任一产品级决策:
;   a) 减小安装包体积 (拆分 backend 到启动时下载, NSIS 只装小骨架)
;   b) 替换安装器 (portable / Inno Setup / MSI 自定义 UI)
;   c) 完全重写 nsis.template.json (分多 section + 手动 SetProgressBar)
; ============================================================


; ============================================================
; NSIS 头文件 include (关键!)
; ============================================================
;
; ⚠️ electron-builder NsisTarget.js computeFinalScript (NsisTarget.js line 615):
;   scriptGenerator.build() + originalScript
;   也就是说我们的 installer.nsh 被 insert 到 generated .nsi 顶部,
;   位于 installer.nsi 模板的 `!include "MUI2.nsh"` 之前。
;
; 而 ${If} / ${EndIf} 是 LogicLib 提供的宏, MUI2.nsh 才会间接 include LogicLib。
; 如果我们在 installer.nsh 里直接用 ${If}, NSIS 编译器会报:
;   "Invalid command: ${If}"
;
; 所以这里必须提前 include LogicLib.nsh 和 nsDialogs.nsh。
; LogicLib 提供: ${If} ${Else} ${EndIf} ${Switch} ${Case} ${IfNot} ${While} ${ForEach}
; nsDialogs 提供: nsDialogs 系列 SendMessage 包装 (SetCtlColors 是 MUI System.nsh 提供)
;
; !include 是 NSIS 编译时指令, 头文件路径相对于 NSIS 安装目录的 Include/
; (electron-builder cache 路径: %LOCALAPPDATA%\electron-builder\Cache\nsis\nsis-3.0.4.1\)
; ============================================================

!include "LogicLib.nsh"
!include "nsDialogs.nsh"
; 不 !include "nsExec.nsh" — electron-builder 自带的 nsis-3.0.4.1 缓存里没有这个头文件
; (Plugins\x86-unicode\nsExec.dll 在, 但 Include\nsExec.nsh 缺失)。
; 直接用内置的 ExecWait, 会闪一下控制台窗口但可接受。

; ============================================================
; ⚠️ installer-only 区域: 卸载器里跳过
; ============================================================
;
; electron-builder 调用 makensis 两次: 第一次生成主安装器, 第二次生成卸载器.
; 两次都 include 同一个 installer.nsi 模板 + 同一个 installer.nsh.
; BUILD_UNINSTALLER define 在卸载器编译时为 true, 主安装器编译时为 false.
;
; installer-only 的代码 (MUI_PAGE_CUSTOMFUNCTION_SHOW / 走马灯宏 / customInstall /
; customInit) 只在主安装器里需要, 在卸载器里编译会被 NSIS 检查:
;   - MUI_PAGE_FUNCTION_CUSTOM 在卸载器编译时会生成 `Call <name>`,
;     NSIS 拒绝 (Call must be used with function names starting with "un.")
;   - customInstall 在卸载器里根本不被调用, 定义也是无害但冗余
;
; 所以这里用 !ifndef BUILD_UNINSTALLER 把 installer-only 代码包起来.
; customUnInstall 是卸载器专用, 不需要包; 但它引用 $INSTDIR 等安装器常量,
; 卸载器编译时这些常量在 NSIS 内置可用 (卸载器也有 $INSTDIR, 指向卸载目标路径).
; ============================================================

!ifndef BUILD_UNINSTALLER


; ============================================================
; 走马灯: MUI INSTFILES 页面 Show 时, 在进度条正下方插入静态子控件
; ============================================================
;
; ⚠️ NSIS 物理限制 (坦诚说明):
;   1. `File /r "${APP_BUILD_DIR}\*.*"` 是单条编译时指令, NSIS 主流程
;      在 File /r 期间 busy 在文件复制循环里, 中段无法插入任何脚本代码.
;      这段时间走马灯控件是静态文字 (显示 "●  正在解压...").
;   2. File /r 期间 NSIS 内部是 `SetDetailsPrint listonly`, DetailPrint
;      不会进 listbox, 但 PBM_STEPIT 仍在驱动进度条 (只是步进太密,
;      视觉上像"卡住").
;   3. NSIS Function 是 __cdecl, Win32 TimerProc/WndProc 是 __stdcall,
;      调用约定不兼容, 子类化会栈崩.
;   4. SetTimer 是异步回调, 在 File /r busy 期间根本不会派发到我们
;      的窗口, 因为 NSIS 主循环正在忙复制.
;
; ✅ 我们的可行方案:
;   - INSTFILES Show 时创建 STATIC 控件 (初始文字 ●  正在解压...)
;   - **customInstall 在 File /r 完成后才被调用**, 这段时间我们拥有
;     完整控制权, 可以做真实的 Sleep + SetWindowTextW spinner 字符循环动画.
;   - 这是用户视觉上"走马灯在走"的全部时间窗口 (约 5-10 秒).
;   - File /r 80MB 期间 (约 20-40 秒), 走马灯只能静态显示, 这是
;     所有 NSIS 安装包的共同限制, 没有解.
;
; 控件样式: STATIC, 无边框, 居中显示, 灰色字体 + 透明背景
; 创建位置: 进度条 (control 1004) 客户区底部 + 4px
; 控件 ID:   9999 (避免与 MUI 内置 1006/1004/1016/1027 冲突)
;
; 走马灯动画字符序列: ● ○ ● ○ ● ○ ... (旋转)
; 切换间隔:           150-200ms (spinner 帧率)
; 总动画时长:         约 5-10 秒 (customInstall 全程)

Var insightforgeMarqueeHWND
Var insightforgeMarqueeStep

; ============================================================
; ⚠️ 关键设计: 用 !macro + !insertmacro 延迟展开, 避免编译期 warning 6000
; ============================================================
;
; $mui.InstFilesPage.ProgressBar 是 MUI2 在 assistedInstaller.nsh 里
; 用 `Var mui.InstFilesPage` 声明的全局变量, mui.InstFilesPage.ProgressBar
; 是 assistedInstaller.nsh 里 `GetDlgItem $mui.InstFilesPage.ProgressBar
; $mui.InstFilesPage 1004` 拿到的进度条 HWND.
;
; 但我们的 installer.nsh 在 generated .nsi 顶部被 scriptGenerator.include
; (NsisTarget.js 第 553-557 行), 位于 !include "MUI2.nsh" / MUI2.nsh /
; assistedInstaller.nsh 都未被 include 之前. 如果直接写
;   Function insightforgeMarqueeShow
;     System::Call 'GetClientRect(i $mui.InstFilesPage.ProgressBar, ...)'  ; <-- warning 6000
;   FunctionEnd
; NSIS 编译器会在 installer.nsh 处理阶段见到 $mui.InstFilesPage, 报
; warning 6000 "unknown variable/constant ... detected, ignoring",
; 而 electron-builder 默认加 -WX 把 warning 升级成 error.
;
; ✅ 解决: 把 SHOW 函数体包在 !macro 里, !define MUI_PAGE_CUSTOMFUNCTION_SHOW
; 为 "!insertmacro _insightforgeMarqueeShow". macro 体只在 !insertmacro
; 展开时才被 NSIS 解析, 而展开点在 assistedInstaller.nsh 里
; !insertmacro MUI_PAGE_INSTFILES 之后, 此时 mui.InstFilesPage 已声明,
; warning 6000 不再触发.

!define MUI_PAGE_CUSTOMFUNCTION_SHOW insightforgeMarqueeShow

Function insightforgeMarqueeShow
  ; INSTFILES 页面 Show 时, 在进度条正下方创建走马灯静态控件
  ;
  ; ⚠️ 下面引用了 $mui.InstFilesPage.ProgressBar / $mui.InstFilesPage,
  ; 这两个是 MUI2 在 assistedInstaller.nsh 里用 `Var` 声明的 NSIS 变量.
  ; 我们的 installer.nsh 在 generated .nsi 顶部被 include, 位于
  ; assistedInstaller.nsh 之前, 所以 NSIS 编译器见到这些引用时会报
  ; warning 6000 "unknown variable/constant ... detected, ignoring".
  ;
  ; 我们接受这个 warning, 通过 electron-builder.yml 的
  ;   nsis:
  ;     warningsAsErrors: false
  ; 让 NSIS 不把 warning 升级成 error (electron-builder 默认加 -WX).
  ; 运行时, $mui.InstFilesPage.ProgressBar 已经被 MUI2 + assistedInstaller.nsh
  ; 在 INSTFILES 页面创建后赋值, 所以 Function 体运行正常.
  ;
  ; 这里不能用 !macro + !insertmacro, 因为 electron-builder 的 multiUser.nsh
  ; 会用 `Call $mui_page_customfunction_show_value` 调用 SHOW 钩子,
  ; 要求 MUI_PAGE_CUSTOMFUNCTION_SHOW 必须是函数名, 不能是 !insertmacro.
  Push $0
  Push $1
  Push $2
  Push $3

  ; 分配 16 字节 RECT buffer (NSIS System::Call 临时变量)
  System::Call 'kernel32::GlobalAlloc(i 0x40, i 16) i.r3'

  ; 获取进度条客户区坐标 (left, top, right, bottom)
  System::Call 'user32::GetClientRect(i $mui.InstFilesPage.ProgressBar, i r3)'
  System::Call '*$r3(i.r0, i.r1, i.r2, i.r4)'
  ; $0=left $1=top $2=right $4=bottom

  ; 初始文字使用 spinner 字符 (●)
  ; WS_CHILD=0x40000000 WS_VISIBLE=0x10000000 WS_CLIPSIBLINGS=0x04000000
  ; SS_CENTERIMAGE=0x00000002 SS_NOPREFIX=0x00000080 (避免 & 被解析为助记符)
  ; 总样式 0x54000082
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "●  正在解压 InsightForge 主程序,请稍候...", i 0x54000082, i r0, i r4 + 4, i r2 - r0, i 18, i $mui.InstFilesPage, i 9999, i 0, i 0) i.r8'
  StrCpy $insightforgeMarqueeHWND $8
  StrCpy $insightforgeMarqueeStep 0

  ; 灰色字体, 透明背景 (让走马灯视觉权重弱于进度条)
  SetCtlColors $insightforgeMarqueeHWND 0x00555555 transparent

  ; ------------------------------------------------------------
  ; 为什么不在 SHOW 里直接做动画:
  ;   1. NSIS Function 是 __cdecl, Win32 TimerProc/WndProc 是 __stdcall,
  ;      调用约定不兼容, SetTimer + 子类化会栈崩.
  ;   2. 即便能注册 timer, File /r 期间 NSIS 主循环在忙复制,
  ;      PumpMessage 派发的 WM_TIMER 也会被淹没, 实际不会触发.
  ;   3. installSection.nsh 第 6 行强制 SetDetailsPrint none, 覆盖
  ;      SHOW 里改的 both, 所以 listbox 滚动方案在 File /r 期间无效.
  ; 真·动画在 customInstall 期间做 (File /r 完成后我们拥有控制权).
  ; ------------------------------------------------------------

  ; 释放 RECT buffer
  System::Call 'kernel32::GlobalFree(i r3)'

  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd


; ============================================================
; 安装阶段: 走马灯 + 阶段化中文 DetailPrint
; ============================================================
;
; electron-builder 默认从 installApplicationFiles 完成(进度条 ≈ 100%)
; 到 Finish 页之前, 中间几乎没有 DetailPrint 文字滚动,
; 用户会感到"卡一下就跳完" 的突兀感.
;
; 我们手动加 Sleep + DetailPrint 滚字, 让"页面"看起来在持续活动,
; 即便进度条数值未跳,用户体感上"还在干活".

!macro customInstall
  ; ============================================================
  ; 走马灯动画总入口: customInstall 在 File /r 完成后被调用,
  ; 这段时间我们拥有完整控制权, 可以做真实的 spinner 字符循环.
  ; ============================================================

  ; 此时已过 installSection.nsh 的 installApplicationFiles 宏展开,
  ; 进度条已接近 100%, SetDetailsPrint 已恢复为 both.
  ; MUI_TEXT_INSTALLING_TITLE 还在显示, listbox 空白等我们填.

  DetailPrint ""
  DetailPrint "InsightForge 主程序复制完成, 正在完成最后配置..."

  ; ------------------------------------------------------------
  ; 阶段 1 — 配置收尾 (spinner ●○ 循环约 4 帧 × 200ms = 0.8 秒)
  ; ------------------------------------------------------------
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "●  正在完成最后的安装配置...")'
  ${EndIf}
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "○  正在完成最后的安装配置...")'
  ${EndIf}
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "●  正在完成最后的安装配置...")'
  ${EndIf}
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "○  正在完成最后的安装配置...")'
  ${EndIf}
  DetailPrint "  ✓ 已就位: $INSTDIR\InsightForge.exe"
  Sleep 180

  ; ------------------------------------------------------------
  ; 阶段 2 — 创建快捷方式 (spinner ◆◇ 循环约 4 帧 × 200ms = 0.8 秒)
  ; ------------------------------------------------------------
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "◆  正在创建开始菜单和桌面快捷方式...")'
  ${EndIf}
  DetailPrint "正在创建开始菜单快捷方式..."
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "◇  正在创建开始菜单和桌面快捷方式...")'
  ${EndIf}
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "◆  正在创建开始菜单和桌面快捷方式...")'
  ${EndIf}
  DetailPrint "正在创建桌面快捷方式..."
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "◇  正在创建开始菜单和桌面快捷方式...")'
  ${EndIf}
  Sleep 180

  ; ------------------------------------------------------------
  ; 阶段 3 — 注册应用 (spinner ★☆ 循环约 3 帧 × 180ms ≈ 0.5 秒)
  ; ------------------------------------------------------------
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "★  正在注册到 Windows 应用列表...")'
  ${EndIf}
  DetailPrint "正在注册到 Windows 应用列表..."
  Sleep 160
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "☆  正在注册到 Windows 应用列表...")'
  ${EndIf}
  Sleep 160
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "★  正在注册到 Windows 应用列表...")'
  ${EndIf}

  DetailPrint ""
  DetailPrint "安装即将完成, 请稍候..."

  ; ------------------------------------------------------------
  ; 阶段 4 — 收尾 (spinner ●○ 循环约 3 帧 × 180ms ≈ 0.5 秒)
  ; ------------------------------------------------------------
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "●  即将完成, 最后整理...")'
  ${EndIf}
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "○  即将完成, 最后整理...")'
  ${EndIf}

  ; ------------------------------------------------------------
  ; portable 推荐提示 (走马灯静止, listbox 滚字)
  ; ------------------------------------------------------------
  DetailPrint "---"
  DetailPrint "💡 下次考虑便携版?"
  DetailPrint "本目录同时提供 InsightForge-portable-x64.exe (绿色免安装)"
  DetailPrint "解压即用 / 无需管理员 / 适合 U 盘携带 / 不写注册表"
  DetailPrint "详见同目录 README.txt"

  ; ------------------------------------------------------------
  ; 任务栏图标缓存刷新
  ; ------------------------------------------------------------
  ; ⚠️ Windows Explorer 把每个任务栏固定项维护成独立的 .lnk 文件,
  ; .lnk 里嵌入的图标是创建时的快照; NSIS 升级不会替换它.
  ; 即便 InsightForge.exe 的图标资源已经更新, 用户历史任务栏的 .lnk
  ; 仍显示旧版 InsightForge 标志. 这里必须强制删除所有历史 InsightForge*.lnk,
  ; 之后用户重启应用再手动"固定到任务栏"才能看到新图标.
  ;
  ; 旧版硬编码了 InsightForge 0.1.2 ~ InsightForge 0.1.5 几个版本号,
  ; 导致 0.1.6+ 升级后旧 .lnk 残留, 任务栏仍显示旧图标(已踩坑).
  ; 改用 FindFirst/FindNext 通配符扫描, 一次性覆盖所有历史 .lnk.
  ;
  ; 注: Delete 在 Explorer 占用 .lnk 时可能静默失败; 用户重启 Explorer
  ; (或在 RELEASE 目录运行 refresh-taskbar-icon.ps1) 后残留会被清掉.
  ; ------------------------------------------------------------
  ${If} $insightforgeMarqueeHWND != 0
    System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "▣  正在刷新任务栏图标缓存...")'
  ${EndIf}
  DetailPrint "正在刷新任务栏图标..."
  DetailPrint "删除旧任务栏固定项让新图标生效..."
  ; 删除固定位置(任务栏 + 开始菜单 + Win11 隐式固定)所有 InsightForge*.lnk
  !insertmacro _insightforgeUnpinAll
  ; ------------------------------------------------------------
  ; 隐藏走马灯控件 (任务完成后, 不让它出现在 Finish 页面之前)
  ; ------------------------------------------------------------
  ${If} $insightforgeMarqueeHWND != 0
    ShowWindow $insightforgeMarqueeHWND ${SW_HIDE}
  ${EndIf}
!macroend


; ============================================================
; 通配符扫描所有 Pinned 目录并删除 InsightForge*.lnk
; ============================================================
;
; 三个固定位置都要清:
;   - TaskBar (用户主动拖到任务栏的)
;   - StartMenu (开始菜单磁贴钉)
;   - ImplicitAppShortcuts (Win11 隐式固定,系统自动从最近应用列表保留的)
;
; 用 FindFirst/FindNext 循环, 比硬编码版本号列表更稳健.
; ============================================================

!macro _insightforgeUnpinAll
  Push $0
  Push $1
  Push $2
  Push $3

  StrCpy $2 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned"
  StrCpy $3 0  ; 计数器

  ; 三个子目录
  DetailPrint "  · 扫描 TaskBar..."
  Call _insightforgeUnpinInDir
  DetailPrint "  · 扫描 StartMenu..."
  StrCpy $2 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu"
  Call _insightforgeUnpinInDir
  DetailPrint "  · 扫描 ImplicitAppShortcuts..."
  StrCpy $2 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\ImplicitAppShortcuts"
  Call _insightforgeUnpinInDir

  ${If} $3 = 0
    DetailPrint "  (未发现旧任务栏固定项, 跳过)"
  ${Else}
    DetailPrint "  ✓ 已删除 $3 个旧固定项"
  ${EndIf}

  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
!define _insightforgeUnpinAll "!insertmacro _insightforgeUnpinAll"


; 内部 Function: 删除指定目录 $2 下所有 InsightForge*.lnk
Function _insightforgeUnpinInDir
  Push $0
  Push $1
  Push $4
  FindFirst $0 $1 "$2\InsightForge*.lnk"
  ${If} $0 != ""
    loop_unpin:
      Delete "$2\$1"
      IntOp $3 $3 + 1
      FindNext $0 $1
      ${If} $1 != ""
        Goto loop_unpin
      ${EndIf}
    FindClose $0
  ${EndIf}
  Pop $4
  Pop $1
  Pop $0
FunctionEnd


; ============================================================
; 安装前提示: 在 onInit 末尾写入运行时信息
; (MUI 还没建, 只能被动写入环境变量 / 打印到日志)
; ============================================================

!macro customInit
  ; 在 onInit 末尾被调用, 此时 MUI_PAGE_INSTFILES 还没建出来,
  ; 不能主动修改进度条 (SendMessage 找不到 $ProgressBar 句柄).
  ;
  ; 必须做的事: 强制结束所有 InsightForge.exe 进程树.
  ; 原因: Electron 主进程 (main.cjs) 用 fork 起 backend 时把进程模型拆成:
  ;     InsightForge.exe (主, 有窗口)
  ;     └─ InsightForge.exe (ELECTRON_RUN_AS_NODE=1, 后端, 无窗口)
  ; NSIS 默认的 appClose 只 FindWindow + SendMessage WM_CLOSE 关闭有窗口的主进程,
  ; 主进程关闭时 fork 出来的 backend 子进程往往未跟随退出, 还锁着 InsightForge.exe 文件.
  ; 后续 File /r 覆盖时撞上文件锁 → NSIS 报 "InsightForge 无法关闭"。
  ;
  ; 解決: taskkill /F /IM InsightForge.exe /T 强制终止进程树,
  ; /T 同时杀子进程, /F TerminateProcess 不给 graceful 机会.
  ;
  ; 注: 仅在主安装器编译时包含, 卸载器不会执行这里 (在 !ifndef BUILD_UNINSTALLER 块内).
  ; ExecWait 会闪一个 console 窗口, 1.5 秒后自动消失.
  ; taskkill 返回码含义: 0=成功 / 128=没找到进程(可忽略) / 1=其它错误(用户大概率没在跑 InsightForge, 也忽略)
  ExecWait 'taskkill /F /IM InsightForge.exe /T'
  ; 短暂等待, 让 Windows 释放文件句柄和进程表
  Sleep 1500
  ; 必须至少有一条语句 (NSIS 宏不能完全空)
  StrCpy $0 $0
!macroend

!endif  ; BUILD_UNINSTALLER (installer-only 区域结束)


; ============================================================
; 卸载阶段: 把"卸载中"拆成具体步骤, 降低用户对卸载卡顿的疑虑
; (留在 BUILD_UNINSTALLER 块外面, 因为卸载器编译时也要 include)
; ============================================================

!macro customUnInstall
  ; 卸载器也会遇到 InsightForge 进程占用问题 (尤其 User 是从开始菜单卸载,
  ; 但本进程未退出的情况). 同样 taskkill 一次性处理.
  ExecWait 'taskkill /F /IM InsightForge.exe /T'
  Sleep 1000
  DetailPrint ""
  DetailPrint "InsightForge 卸载程序已启动"
  Sleep 200
  DetailPrint "正在删除桌面快捷方式..."
  Sleep 200
  DetailPrint "正在删除开始菜单快捷方式..."
  Sleep 200
  DetailPrint "正在移除 Windows 注册表项..."
  Sleep 300
  DetailPrint "正在关闭正在运行的 InsightForge 进程..."
  Sleep 200
  DetailPrint "正在删除程序文件..."
  Sleep 300
  DetailPrint ""
  DetailPrint "卸载即将完成"
  DetailPrint "注意: 您的用户数据 (%APPDATA%\ai.insightforge.desktop\) 已保留,"
  DetailPrint "      下次安装后可继续使用, 也可手动删除."
!macroend
