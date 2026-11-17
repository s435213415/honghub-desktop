/* 原生与页面共享的最小状态（避免 ability 与 UI 之间跨层取值） */
export class KhBridgeStore {
  static canBack: boolean = false;
  static orientation: string = '';
}
