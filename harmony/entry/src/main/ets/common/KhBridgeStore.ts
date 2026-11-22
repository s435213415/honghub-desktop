/* 原生与页面共享的最小状态（避免 ability 与 UI 之间跨层取值） */
export class KhBridgeStore {
  static canBack: boolean = false;
  static orientation: string = '';
  /* 「平台浏览」页在场时置 true：返回键交给浏览页自己处理，不再被首页的 canBack 拦走 */
  static browserActive: boolean = false;
}
