; 鸿汇影 · 安装/卸载补丁（electron-builder custom macro）
; 1) 卸载项补 InstallLocation：模板只写 INSTALL_REGISTRY_KEY，Windows「应用和功能」里的位置列是空的
; 2) 卸载末尾先把工作目录切出安装目录再删空目录，避免卸载器自身占用导致 $INSTDIR 留一个空壳
!macro customInstall
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
!macroend

!macro customUnInstall
  SetOutPath "$TEMP"
  RMDir "$INSTDIR"
!macroend
