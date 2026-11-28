; 鸿汇影 · 安装/卸载补丁（electron-builder custom macro）
; --------------------------------------------------------------
; 1) 卸载项补 InstallLocation：模板只写 INSTALL_REGISTRY_KEY，Windows「应用和功能」里的位置列是空的
; 2) 卸载末尾先把工作目录切出安装目录再删空目录，避免卸载器自身占用导致 $INSTDIR 留一个空壳
; 3) 1.7.88（台账 #160）卸载前自动备份个人数据 → 询问是否删除 → 清理开机自启注册表残留
;
; 备份放在「文档\鸿汇影·卸载备份\v<版本>」（同版本多次卸载依次生成 -1、-2 后缀），
; 里面是 Roaming 下的用户数据（收藏 / 历史 / 设置 / 自建站点 / 影视仓）与安装目录 server\data。
; 注意：这里按「当前登录用户」的 $PROFILE 取数据，而不是 $APPDATA —— 卸载器若被提到管理员权限，
;       $APPDATA 会指向管理员账户，备份就会拷错人的数据。

!ifndef KH_BAK_ROOT
!define KH_BAK_ROOT "$DOCUMENTS\鸿汇影·卸载备份"
!endif
!ifndef KH_UD_NAME
!define KH_UD_NAME "鸿汇影桌面版"
!endif
; 数据源单独做成可覆盖 define，scripts/test-installer-nsh.js 会在临时目录里真跑一遍卸载流程
!ifndef KH_UD_SRC
!define KH_UD_SRC "$PROFILE\AppData\Roaming\${KH_UD_NAME}"
!endif
!ifndef KH_DEV_SRC
!define KH_DEV_SRC "$PROFILE\AppData\Roaming\HongHub-Desktop-Dev"
!endif

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
!macroend

!macro customUnInstall
  ; ============ 1) 备份个人数据 ============
  StrCpy $0 "${KH_BAK_ROOT}\v${VERSION}"
  StrCpy $1 0

  kh_bak_pick:
    IntCmp $1 0 kh_bak_probe kh_bak_suffix kh_bak_suffix
  kh_bak_suffix:
    StrCpy $0 "${KH_BAK_ROOT}\v${VERSION}-$1"
  kh_bak_probe:
    IfFileExists "$0\*.*" 0 kh_bak_ready
    IntOp $1 $1 + 1
    IntCmp $1 20 kh_bak_ready kh_bak_pick kh_bak_pick
  kh_bak_ready:

  CreateDirectory "$0"
  ClearErrors
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /c xcopy "${KH_UD_SRC}" "$0\用户数据" /E /I /Q /Y'
  Pop $2
  ClearErrors
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /c xcopy "$INSTDIR\server\data" "$0\中枢数据" /E /I /Q /Y'
  Pop $3

  ; 备份说明（UTF-16LE + BOM 写，记事本/写字板打开必定不乱码）
  FileOpen $4 "$0\说明.txt" w
  FileWriteByte $4 255
  FileWriteByte $4 254
  FileWriteUTF16LE $4 "鸿汇影 · 卸载备份$\r$\n$\r$\n"
  FileWriteUTF16LE $4 "本目录是卸载 ${VERSION} 时自动留下的个人数据备份。$\r$\n$\r$\n"
  FileWriteUTF16LE $4 "用户数据：收藏 / 稍后看 / 观看历史 / 续播进度 / 自建站点 / 影视仓 / 场景预设 / 设置项$\r$\n"
  FileWriteUTF16LE $4 "中枢数据：安装目录 server\data 里的清单、快照与日志$\r$\n$\r$\n"
  FileWriteUTF16LE $4 "怎么找回：$\r$\n"
  FileWriteUTF16LE $4 "1. 重新安装鸿汇影（版本不限），先启动一次再退出；$\r$\n"
  FileWriteUTF16LE $4 "2. 用应用内「设置 · 备份与恢复 → 导入备份」选择本目录下的 JSON 备份；$\r$\n"
  FileWriteUTF16LE $4 "3. 若没有 JSON，把「用户数据」目录整体覆盖回 %APPDATA%\${KH_UD_NAME} 再启动。$\r$\n$\r$\n"
  FileWriteUTF16LE $4 "同一版本多次卸载会依次生成 v${VERSION}、v${VERSION}-1、v${VERSION}-2……，后缀越大越新。$\r$\n"
  FileWriteUTF16LE $4 "本备份不会被卸载流程删除；不需要时请自行删除。$\r$\n"
  FileClose $4

  ; ============ 2) 询问是否删除个人数据（静默卸载默认保留） ============
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "个人数据已备份到：$\r$\n$0$\r$\n$\r$\n要一并删除本机上的个人数据吗？$\r$\n$\r$\n是 = 删除（备份文件仍保留，可随时找回）$\r$\n否 = 保留，重装后自动读回" IDYES kh_del_data
  ${EndIf}
  Goto kh_keep_data

  kh_del_data:
    RMDir /r "${KH_UD_SRC}"
    RMDir /r "${KH_DEV_SRC}"
    Goto kh_clean_autostart

  kh_keep_data:
    ; 个人数据留在原处，卸载不碰

  ; ============ 3) 清理开机自启残留 ============
  ; Electron 的 setLoginItemSettings 写的是 HKCU Run，卸载器不会自动清；
  ; 值名可能是产品名，也可能是 electron.app.<name>，四种都删一遍（不存在时删除不报错）。
  kh_clean_autostart:
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${KH_UD_NAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.${KH_UD_NAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "honghub-desktop"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.honghub-desktop"

  ; ============ 4) 切出安装目录再删空壳 ============
  SetOutPath "$TEMP"
  ; server 是安装目录里的运行时数据（清单/快照/日志），已备份到「中枢数据」，这里整棵删掉，
  ; 否则 RMDir "$INSTDIR" 会因为目录非空失败，卸载后留下 …\server 空壳。
  RMDir /r "$INSTDIR\server"
  RMDir "$INSTDIR"
!macroend
