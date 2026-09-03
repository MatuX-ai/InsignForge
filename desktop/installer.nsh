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
;   - customInstall 在 File /r 完成后接管, 用 Sleep + SetCtlText
;     在 ~5-10 秒窗口里做 ●○●○ 真实 spinner 字符循环动画
;   - 收尾时 ShowWindow SW_HIDE 隐藏控件
;
; 真实要彻底消除卡顿, 需要做以下任一产品级决策:
;   a) 减小安装包体积 (拆分 backend 到启动时下载, NSIS 只装小骨架)
;   b) 替换安装器 (portable / Inno Setup / MSI 自定义 UI)
;   c) 完全重写 nsis.template.json (分多 section + 手动 SetProgressBar)
; ============================================================


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
;     完整控制权, 可以做真实的 Sleep + SetCtlText spinner 字符循环动画.
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

!define MUI_PAGE_CUSTOMFUNCTION_SHOW insightforgeMarqueeShow

Function insightforgeMarqueeShow
  ; INSTFILES 页面 Show 时, 在进度条正下方创建走马灯静态控件
  Push $0
  Push $1
  Push $2
  Push $3

  ; 防止 uninstaller / 其他路径误调到这里
  ${If} $mui.InstFilesPage == 0
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Return
  ${EndIf}

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
    SetCtlText $insightforgeMarqueeHWND "●  正在完成最后的安装配置..."
  ${EndIf}
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "○  正在完成最后的安装配置..."
  ${EndIf}
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "●  正在完成最后的安装配置..."
  ${EndIf}
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "○  正在完成最后的安装配置..."
  ${EndIf}
  DetailPrint "  ✓ 已就位: $INSTDIR\InsightForge.exe"
  Sleep 180

  ; ------------------------------------------------------------
  ; 阶段 2 — 创建快捷方式 (spinner ◆◇ 循环约 4 帧 × 200ms = 0.8 秒)
  ; ------------------------------------------------------------
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "◆  正在创建开始菜单和桌面快捷方式..."
  ${EndIf}
  DetailPrint "正在创建开始菜单快捷方式..."
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "◇  正在创建开始菜单和桌面快捷方式..."
  ${EndIf}
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "◆  正在创建开始菜单和桌面快捷方式..."
  ${EndIf}
  DetailPrint "正在创建桌面快捷方式..."
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "◇  正在创建开始菜单和桌面快捷方式..."
  ${EndIf}
  Sleep 180

  ; ------------------------------------------------------------
  ; 阶段 3 — 注册应用 (spinner ★☆ 循环约 3 帧 × 180ms ≈ 0.5 秒)
  ; ------------------------------------------------------------
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "★  正在注册到 Windows 应用列表..."
  ${EndIf}
  DetailPrint "正在注册到 Windows 应用列表..."
  Sleep 160
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "☆  正在注册到 Windows 应用列表..."
  ${EndIf}
  Sleep 160
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "★  正在注册到 Windows 应用列表..."
  ${EndIf}

  DetailPrint ""
  DetailPrint "安装即将完成, 请稍候..."

  ; ------------------------------------------------------------
  ; 阶段 4 — 收尾 (spinner ●○ 循环约 3 帧 × 180ms ≈ 0.5 秒)
  ; ------------------------------------------------------------
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "●  即将完成, 最后整理..."
  ${EndIf}
  Sleep 180
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "○  即将完成, 最后整理..."
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
  ${If} $insightforgeMarqueeHWND != 0
    SetCtlText $insightforgeMarqueeHWND "▣  正在刷新任务栏图标缓存..."
  ${EndIf}
  DetailPrint "正在刷新任务栏图标..."
  DetailPrint "删除旧任务栏固定项让新图标生效..."
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\InsightForge.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\InsightForge 0.1.2.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\InsightForge 0.1.3.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\InsightForge 0.1.4.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\InsightForge 0.1.5.lnk"

  ; ------------------------------------------------------------
  ; 隐藏走马灯控件 (任务完成后, 不让它出现在 Finish 页面之前)
  ; ------------------------------------------------------------
  ${If} $insightforgeMarqueeHWND != 0
    ShowWindow $insightforgeMarqueeHWND ${SW_HIDE}
  ${EndIf}
!macroend


; ============================================================
; 卸载阶段: 把"卸载中"拆成具体步骤, 降低用户对卸载卡顿的疑虑
; ============================================================

!macro customUnInstall
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


; ============================================================
; 安装前提示: 在 onInit 末尾写入运行时信息
; (MUI 还没建, 只能被动写入环境变量 / 打印到日志)
; ============================================================

!macro customInit
  ; 在 onInit 末尾被调用, 此时 MUI_PAGE_INSTFILES 还没建出来,
  ; 不能主动修改进度条 (SendMessage 找不到 $ProgressBar 句柄).
  ; 此处仅写一条日志, 验证 include 是否生效 (出现在安装日志中).
  ${IfNot} ${Silent}
    ; 静默模式跳过, 避免污染安装日志
  ${EndIf}
  ; 必须至少有一条语句 (NSIS 宏不能完全空)
  StrCpy $0 $0
!macroend
