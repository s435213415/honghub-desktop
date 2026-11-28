/* HongHub 前端模块：片单/平台基线/远程配置/直播/升级状态机
   由 app/index.html 单文件版拆分（1.7.72 模块化），按 <script> 顺序加载，顶层函数/常量共享全局作用域。 */
/* ---------------- 片单数据：全部为真实网络片源，每部 3 路自动回退，应用不内置任何本地视频 ---------------- */
/* 1.7.102：不再预置任何样本片源。原 6 部开源电影 / 早年预告（含 2 部完整版）已整块移除；
   片源全部来自「资源」页自建与平台入口，包内不带任何预置条目，也不留占位条目。 */
var MOVIES = [];
/* ---------------- 影视资源配置：内置资源 + 自建资源 ---------------- */
var RES_CATEGORIES = ['电影','动画','短剧','剧集','纪录片','综艺'];
function getRes(){
  var v = getStore('kh_vod_res', []);
  if(!Array.isArray(v)){ setStore('kh_vod_res', []); return []; }
  var out = [];
  for(var i=0;i<v.length;i++){
    var r = v[i];
    if(r && typeof r.title === 'string' && Array.isArray(r.sources) && r.sources.length) out.push(r);
  }
  return out;
}
/* 1.7.91 #53：儿童模式在数据源头过滤，首页 / 分类 / 搜索 / 推荐 / 自动下一部共用同一份结果 */
function allMovies(){
  var list = MOVIES.concat(getRes());
  try{
    if(typeof khKidOn === 'function' && khKidOn() && typeof khKidAllows === 'function'){
      return list.filter(function(m){ return khKidAllows(m); });
    }
  }catch(e){}
  return list;
}
/* 最近观看置顶：按本机历史顺序，最近看过的排前；未看过的保持原相对顺序（稳定排序）。 */
function khRecentFirst(list){
  var hist = getHistory();
  var rank = {};
  for(var i=0;i<hist.length;i++) rank[hist[i]] = i;
  return list.slice().sort(function(a,b){
    var ra = (a.id in rank) ? rank[a.id] : Number.MAX_SAFE_INTEGER;
    var rb = (b.id in rank) ? rank[b.id] : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}
/* ---------------- 各大网站平台影视资源（2026-11-13 同步更新） ----------------
   预置平台从 6 个扩充到 13 个，全部为官方站点首页；下方 SEARCH_TPL 为每个平台
   按分类同步更新的官方检索 / 频道入口，均已逐条 HTTP 实测可达。 */
/* mode：wap=移动 H5（移动 UA 打开 mobile 地址）/ pc=官方桌面网页
   oversea=海外站（需网络条件，建议系统浏览器）/ project=只读项目页。
   mobile 与 mode 由 _signtmp/probe_platforms.py 双 UA 实测得出：
   1905 / 猫眼 / YY 的 www 域对桌面 UA 返回 403 / 403 / 436，移动 UA 则为 200；
   淘票票 www 域 8 跳重定向到登录页（-310 元凶之一），已换成不跳转的落地域名。 */
var PLAT_MODE = {
  wap:{label:'H5 可看',hint:'手机/平板网页版，点开即用',direct:true},
  pc:{label:'网页版',hint:'官方桌面网页，可在顶部切手机版',direct:true},
  oversea:{label:'海外站',hint:'受网络条件限制，建议系统浏览器打开',direct:false},
  project:{label:'只读项目页',hint:'第三方桌面端项目介绍，不能安装到开鸿',direct:false}
};
var BUILTIN_SITES = [
{name:"哔哩哔哩",url:"https://www.bilibili.com",color:"#FB7299",tag:"B",cat:"综合视频",mobile:"https://m.bilibili.com/",mode:"wap"},
{name:"腾讯视频",url:"https://v.qq.com",color:"#FF6A00",tag:"腾",cat:"综合视频",mobile:"https://m.v.qq.com/",mode:"wap"},
{name:"爱奇艺",url:"https://www.iqiyi.com",color:"#00BE06",tag:"爱",cat:"综合视频",mobile:"https://m.iqiyi.com/",mode:"wap"},
{name:"优酷",url:"https://www.youku.com",color:"#1E8FFF",tag:"优",cat:"综合视频",mobile:"https://m.youku.com/",mode:"wap"},
{name:"芒果TV",url:"https://www.mgtv.com",color:"#FF7A2F",tag:"芒",cat:"综合视频",mobile:"https://m.mgtv.com/",mode:"wap"},
{name:"西瓜视频",url:"https://www.ixigua.com",color:"#F04142",tag:"西",cat:"综合视频",mobile:"https://m.ixigua.com/",mode:"wap"},
{name:"咪咕视频",url:"https://www.miguvideo.com",color:"#E60012",tag:"咪",cat:"综合视频",mobile:"https://m.miguvideo.com/",mode:"wap"},
{name:"AcFun",url:"https://www.acfun.cn",color:"#FD4C5B",tag:"A",cat:"综合视频",mobile:"https://m.acfun.cn/",mode:"wap"},
{name:"搜狐视频",url:"https://tv.sohu.com",color:"#FF6600",tag:"搜",cat:"综合视频",mode:"pc"},
{name:"乐视视频",url:"https://www.le.com",color:"#D4237A",tag:"乐",cat:"综合视频",mobile:"https://m.le.com/",mode:"wap"},
{name:"PPTV 聚力",url:"https://www.pptv.com",color:"#1E8FFF",tag:"P",cat:"综合视频",mobile:"https://m.pptv.com/",mode:"wap"},
{name:"央视频",url:"https://www.yangshipin.cn",color:"#D2232A",tag:"央",cat:"综合视频",mode:"pc"},
{name:"风行网",url:"https://www.fun.tv",color:"#FF5000",tag:"风",cat:"综合视频",mode:"pc"},
{name:"好看视频",url:"https://haokan.baidu.com",color:"#2932E1",tag:"好",cat:"综合视频",mode:"pc"},
{name:"央视网",url:"https://tv.cctv.com",color:"#B01F24",tag:"视",cat:"综合视频",mode:"pc"},
{name:"中国蓝TV",url:"https://www.cztv.com",color:"#0057B8",tag:"蓝",cat:"广电官网",mode:"pc"},
{name:"荔枝网",url:"https://www.jstv.com",color:"#E8442E",tag:"荔",cat:"广电官网",mode:"pc"},
{name:"SMG上海台",url:"https://www.smg.cn",color:"#1E8FFF",tag:"上",cat:"广电官网",mode:"pc"},
{name:"抖音",url:"https://www.douyin.com",color:"#161823",tag:"抖",cat:"短视频/社区",mode:"pc"},
{name:"快手",url:"https://www.kuaishou.com",color:"#FF4906",tag:"快",cat:"短视频/社区",mode:"wap"},
{name:"梨视频",url:"https://www.pearvideo.com",color:"#FF6633",tag:"梨",cat:"短视频/社区",mode:"pc"},
{name:"腾讯微视",url:"https://weishi.qq.com",color:"#FF6A00",tag:"微",cat:"短视频/社区",mode:"wap"},
{name:"豆瓣电影",url:"https://movie.douban.com",color:"#2E963D",tag:"豆",cat:"影视资讯/数据库",mobile:"https://m.douban.com/movie/",mode:"wap"},
{name:"1905电影网",url:"https://www.1905.com",color:"#C8102E",tag:"19",cat:"影视资讯/数据库",mobile:"https://m.1905.com/",mode:"wap"},
{name:"猫眼电影",url:"https://www.maoyan.com",color:"#EE4D2D",tag:"猫",cat:"影视资讯/数据库",mobile:"https://m.maoyan.com/",mode:"wap"},
{name:"淘票票",url:"https://dianying.taobao.com",color:"#FF5000",tag:"淘",cat:"影视资讯/数据库",mobile:"https://m.taopiaopiao.com/",mode:"wap"},
{name:"斗鱼",url:"https://www.douyu.com",color:"#FF5C00",tag:"鱼",cat:"直播平台",mobile:"https://m.douyu.com/",mode:"pc"},
{name:"虎牙直播",url:"https://www.huya.com",color:"#FF8000",tag:"虎",cat:"直播平台",mobile:"https://m.huya.com/",mode:"wap"},
{name:"YY直播",url:"https://www.yy.com",color:"#FF6A00",tag:"Y",cat:"直播平台",mobile:"https://m.yy.com/",mode:"wap"},
{name:"IMDb",url:"https://www.imdb.com",color:"#F5C518",tag:"IM",cat:"海外官方",mode:"oversea"},
{name:"烂番茄",url:"https://www.rottentomatoes.com",color:"#FA320A",tag:"RT",cat:"海外官方",mode:"oversea"},
{name:"YouTube",url:"https://www.youtube.com",color:"#FF0000",tag:"YT",cat:"海外官方",mode:"oversea"},
{name:"Vimeo",url:"https://vimeo.com",color:"#1AB7EA",tag:"VM",cat:"海外官方",mode:"oversea"},
{name:"找剧AI",url:"https://zhaoju4.com/",color:"#7C5CFF",tag:"找",cat:"AI 搜剧",mode:"pc"},
{name:"红果短剧",url:"https://hongguoduanju.com/",color:"#FF4D4F",tag:"红",cat:"短剧平台",mode:"wap"},
{name:"hongguo-player",url:"https://git.hiwiki.org/zh-CN/repo/yangbin1322/hongguo-player",color:"#3B456B",tag:"H",cat:"第三方桌面端",mode:"project"},
{name:"华数TV",url:"https://www.wasu.com.cn",color:"#1E8FFF",tag:"华",cat:"综合视频",mode:"pc"},
{name:"网易视频",url:"https://v.163.com",color:"#E60012",tag:"易",cat:"综合视频",mode:"pc"},
{name:"凤凰视频",url:"https://v.ifeng.com",color:"#F5A623",tag:"凤",cat:"综合视频",mode:"pc"},
{name:"时光网",url:"https://www.mtime.com",color:"#2B6CB0",tag:"光",cat:"影视资讯/数据库",mode:"pc"},
{name:"网易CC直播",url:"https://live.163.com",color:"#E60012",tag:"C",cat:"直播平台",mode:"pc"},
{name:"龙珠直播",url:"https://www.longzhu.com",color:"#1E8FFF",tag:"珠",cat:"直播平台",mobile:"https://m.longzhu.com/",mode:"wap"},
{name:"六间房",url:"https://www.6.cn",color:"#FF4D4F",tag:"六",cat:"直播平台",mode:"pc"},
{name:"小红书",url:"https://www.xiaohongshu.com",color:"#FF2442",tag:"书",cat:"短视频/社区",mode:"pc"},
{name:"齐鲁网",url:"https://www.iqilu.com",color:"#0057B8",tag:"鲁",cat:"广电官网",mode:"pc"},
{name:"北京时间",url:"https://www.btime.com",color:"#D2232A",tag:"京",cat:"广电官网",mode:"pc"},
{name:"四川广电",url:"https://www.sctv.com",color:"#2E963D",tag:"川",cat:"广电官网",mode:"pc"},
{name:"河北广电",url:"https://www.hebtv.com",color:"#1E8FFF",tag:"冀",cat:"广电官网",mode:"pc"},
{name:"黑龙江广电",url:"https://www.hljtv.com",color:"#7C5CFF",tag:"黑",cat:"广电官网",mode:"pc"},
{name:"云南广电",url:"https://www.yntv.cn",color:"#1AB7EA",tag:"滇",cat:"广电官网",mode:"pc"},
{name:"广西广电",url:"https://www.gxtv.cn",color:"#FF7A2F",tag:"桂",cat:"广电官网",mode:"pc"},
{name:"内蒙古广电",url:"https://www.nmtv.cn",color:"#8B5E3C",tag:"蒙",cat:"广电官网",mode:"pc"},
{name:"山西广电",url:"https://www.sxrtv.com",color:"#C8102E",tag:"晋",cat:"广电官网",mode:"pc"},
{name:"河南广电",url:"https://www.hntv.tv",color:"#E8442E",tag:"豫",cat:"广电官网",mode:"pc"},
{name:"贵州广电",url:"https://www.gzstv.com",color:"#00BE06",tag:"黔",cat:"广电官网",mode:"pc"},
{name:"甘肃广电",url:"https://www.gstv.com.cn",color:"#B8860B",tag:"陇",cat:"广电官网",mode:"pc"},
{name:"吉林广电",url:"https://www.jlntv.cn",color:"#2932E1",tag:"吉",cat:"广电官网",mode:"pc"},
{name:"江西广电",url:"https://www.jxntv.cn",color:"#D4237A",tag:"赣",cat:"广电官网",mode:"pc"},
{name:"湖北广电",url:"https://www.hbtv.com.cn",color:"#00665A",tag:"鄂",cat:"广电官网",mode:"pc"},
{name:"天津北方网",url:"https://www.enorth.com.cn",color:"#D2232A",tag:"津",cat:"广电官网",mode:"pc"},
{name:"南方网",url:"https://www.southcn.com",color:"#0057B8",tag:"粤",cat:"广电官网",mode:"pc"},
{name:"安徽广电",url:"https://www.ahtv.cn",color:"#2E963D",tag:"皖",cat:"广电官网",mode:"pc"},
{name:"重庆广电",url:"https://www.cbg.cn",color:"#FF6A00",tag:"渝",cat:"广电官网",mode:"pc"},
{name:"南海网",url:"https://www.hinews.cn",color:"#1AB7EA",tag:"琼",cat:"广电官网",mode:"pc"},
{name:"新疆广电",url:"https://www.xjtvs.com.cn",color:"#7C5CFF",tag:"新",cat:"广电官网",mode:"pc"},
{name:"宁夏广电",url:"https://www.nxtv.cn",color:"#E60012",tag:"宁",cat:"广电官网",mode:"pc"},
{name:"陕西广电",url:"http://www.snrtv.com/",color:"#C8102E",tag:"陕",cat:"广电官网",mode:"pc"},
{name:"香港TVB",url:"https://www.tvb.com",color:"#3B456B",tag:"港",cat:"广电官网",mode:"pc"},
{name:"VEVO",url:"https://www.vevo.com",color:"#FF0000",tag:"VE",cat:"海外官方",mode:"oversea"},
{name:"腾讯动漫",url:"https://ac.qq.com",color:"#FF6A00",tag:"腾",cat:"动漫漫画",mode:"pc"},
{name:"B站漫画",url:"https://manga.bilibili.com",color:"#FB7299",tag:"漫",cat:"动漫漫画",mode:"pc"},
{name:"快看漫画",url:"https://www.kuaikanmanhua.com",color:"#FF5C8A",tag:"快",cat:"动漫漫画",mode:"pc"},
{name:"直播吧",url:"https://www.zhibo8.com",color:"#1E8FFF",tag:"直",cat:"体育视频",mode:"pc"},
{name:"懂球帝",url:"https://www.dongqiudi.com",color:"#00BE06",tag:"懂",cat:"体育视频",mode:"pc"},
{name:"虎扑",url:"https://www.hupu.com",color:"#FF8000",tag:"扑",cat:"体育视频",mode:"pc"},
{name:"腾讯体育",url:"https://sports.qq.com",color:"#FF6A00",tag:"体",cat:"体育视频",mode:"pc"},
{name:"央视体育",url:"https://sports.cctv.com",color:"#B01F24",tag:"视",cat:"体育视频",mode:"pc"},
{name:"微博",url:"https://weibo.com",color:"#E6162D",tag:"微",cat:"短视频/社区",mode:"pc"},
{name:"皮皮虾",url:"https://www.pipix.com",color:"#FF6633",tag:"皮",cat:"短视频/社区",mode:"pc"},
{name:"福建海博TV",url:"https://www.fjtv.net",color:"#0057B8",tag:"闽",cat:"广电官网",mode:"pc"},
{name:"青海长云网",url:"https://www.qhbtv.com.cn",color:"#2E963D",tag:"青",cat:"广电官网",mode:"pc"},
{name:"西藏之声",url:"http://www.vtibet.com",color:"#7C5CFF",tag:"藏",cat:"广电官网",mode:"pc"},
{name:"百视通BesTV",url:"https://www.bestv.com.cn",color:"#1E8FFF",tag:"百",cat:"综合视频",mode:"pc"},
{name:"网易云音乐",url:"https://music.163.com",color:"#C20C0C",tag:"云",cat:"音乐",mode:"pc"},
{name:"QQ音乐",url:"https://y.qq.com",color:"#31C27C",tag:"Q",cat:"音乐",mode:"pc"},
{name:"酷狗音乐",url:"https://www.kugou.com",color:"#2C9CF0",tag:"狗",cat:"音乐",mode:"pc"},
{name:"酷我音乐",url:"https://www.kuwo.cn",color:"#FFB800",tag:"酷",cat:"音乐",mode:"pc"},
{name:"咪咕音乐",url:"https://music.migu.cn",color:"#E60012",tag:"咪",cat:"音乐",mode:"pc"},
{name:"全民K歌",url:"https://kg.qq.com",color:"#FF4D4F",tag:"唱",cat:"音乐",mode:"pc"},
{name:"汽水音乐",url:"https://music.douyin.com",color:"#FE2C55",tag:"汽",cat:"音乐",mode:"pc"},
{name:"Apple Music",url:"https://music.apple.com/cn",color:"#FA2D48",tag:"A",cat:"音乐",mode:"pc"},
{name:"千千音乐",url:"https://music.taihe.com",color:"#1E90FF",tag:"千",cat:"音乐",mode:"pc"},
{name:"荔枝FM",url:"https://www.lizhi.fm",color:"#FF4D4F",tag:"荔",cat:"有声/播客",mode:"pc"},
{name:"Spotify",url:"https://open.spotify.com",color:"#1DB954",tag:"S",cat:"音乐（海外）",mode:"oversea"},
{name:"YouTube Music",url:"https://music.youtube.com",color:"#FF0000",tag:"YM",cat:"音乐（海外）",mode:"oversea"},
{name:"SoundCloud",url:"https://soundcloud.com",color:"#FF5500",tag:"SC",cat:"音乐（海外）",mode:"oversea"},
{name:"澎湃新闻",url:"https://www.thepaper.cn",color:"#1A1A1A",tag:"澎",cat:"资讯/门户",mode:"pc"},
{name:"观察者网",url:"https://www.guancha.cn",color:"#C8102E",tag:"观",cat:"资讯/门户",mode:"pc"},
{name:"36氪",url:"https://36kr.com",color:"#121212",tag:"36",cat:"资讯/门户",mode:"pc"},
{name:"人民网视频",url:"https://tv.people.com.cn",color:"#D2232A",tag:"人",cat:"资讯/门户",mode:"pc"},
{name:"新华网",url:"https://www.news.cn",color:"#E60012",tag:"新",cat:"资讯/门户",mode:"pc"},
{name:"中新网",url:"https://www.chinanews.com",color:"#0057B8",tag:"中",cat:"资讯/门户",mode:"pc"},
{name:"新浪体育",url:"https://sports.sina.com.cn",color:"#FF8200",tag:"浪",cat:"资讯/门户",mode:"pc"},
{name:"搜狐体育",url:"https://sports.sohu.com",color:"#FF6600",tag:"狐",cat:"资讯/门户",mode:"pc"},
{name:"懂车帝",url:"https://www.dongchedi.com",color:"#0066FF",tag:"车",cat:"汽车",mode:"pc"},
{name:"汽车之家",url:"https://www.autohome.com.cn",color:"#F47B2A",tag:"家",cat:"汽车",mode:"pc"},
{name:"游民星空",url:"https://www.gamersky.com",color:"#2E963D",tag:"游",cat:"游戏",mode:"pc"},
{name:"17173",url:"https://www.17173.com",color:"#E8442E",tag:"17",cat:"游戏",mode:"pc"},
{name:"4399",url:"https://www.4399.com",color:"#FF6600",tag:"43",cat:"游戏",mode:"pc"},
{name:"下厨房",url:"https://www.xiachufang.com",color:"#E23B3B",tag:"厨",cat:"生活/图文",mode:"pc"},
{name:"图虫",url:"https://tuchong.com",color:"#2932E1",tag:"图",cat:"生活/图文",mode:"pc"},
{name:"站酷",url:"https://www.zcool.com.cn",color:"#0099FF",tag:"站",cat:"生活/图文",mode:"pc"},
{name:"知乎",url:"https://www.zhihu.com",color:"#0066FF",tag:"知",cat:"生活/图文",mode:"pc"},
{name:"大众点评",url:"https://www.dianping.com",color:"#FF6633",tag:"评",cat:"生活/图文",mode:"pc"},
{name:"网易公开课",url:"https://open.163.com",color:"#E60012",tag:"课",cat:"教育",mode:"pc"},
{name:"腾讯课堂",url:"https://ke.qq.com",color:"#FF6A00",tag:"堂",cat:"教育",mode:"pc"},
{name:"喜马拉雅",url:"https://www.ximalaya.com",color:"#FF8200",tag:"喜",cat:"有声/播客",mode:"pc"},
{name:"小宇宙播客",url:"https://www.xiaoyuzhoufm.com",color:"#5B8DEF",tag:"宙",cat:"有声/播客",mode:"pc"},
{name:"蜻蜓FM",url:"https://www.qingting.fm",color:"#2E7D32",tag:"蜻",cat:"有声/播客",mode:"pc"},
{name:"花椒直播",url:"https://www.huajiao.com",color:"#FF5C00",tag:"椒",cat:"直播平台",mode:"pc"},
{name:"映客直播",url:"https://www.inke.cn",color:"#FF2442",tag:"映",cat:"直播平台",mode:"pc"},
{name:"酷狗直播",url:"https://fanxing.kugou.com",color:"#2C9CF0",tag:"星",cat:"直播平台",mode:"pc"},
{name:"淘宝直播",url:"https://live.taobao.com",color:"#FF5000",tag:"淘",cat:"电商直播",mode:"pc"},
{name:"京东直播",url:"https://zhibo.jd.com",color:"#E1251B",tag:"京",cat:"电商直播",mode:"pc"}
];
/* 平台 × 影视资源分类：与站内 RES_CATEGORIES / MOVIES 的分类口径保持一致 */
var PLATFORM_CATS = [
  {cat:'电影', kw:'电影'},
  {cat:'动画', kw:'动漫'},
  {cat:'短剧', kw:'短剧'},
  {cat:'剧集', kw:'电视剧'},
  {cat:'纪录片', kw:'纪录片'},
  {cat:'综艺', kw:'综艺'}
];
/* 官方检索模板，{kw} 会被替换为 URL 编码的关键词。逐条 HTTP 实测：
   - 仅保留服务端渲染、HTML 回显检索词、参数真实生效的入口；
   - 梨视频、1905、YY、淘票票及海外站、多数广电门户实测无稳定公开检索页，留空并诚实标「官方首页」，
     不再把首页伪装成分类直达。当前共 20 个平台提供真·分类检索。 */
var SEARCH_TPL = {
  '哔哩哔哩':'https://search.bilibili.com/all?keyword={kw}',
  '腾讯视频':'https://v.qq.com/x/search/?q={kw}',
  '爱奇艺':'https://so.iqiyi.com/so/q_{kw}',
  '优酷':'https://so.youku.com/search_video/q_{kw}',
  '芒果TV':'https://www.mgtv.com/so/?keyword={kw}',
  '西瓜视频':'https://www.ixigua.com/search/{kw}/',
  '咪咕视频':'https://www.miguvideo.com/mgs/website/prd/search.html?keyword={kw}',
  'AcFun':'https://www.acfun.cn/search?keyword={kw}',
  '乐视视频':'https://so.le.com/s?wd={kw}',
  'PPTV 聚力':'https://search.pptv.com/s_video?kw={kw}',
  '央视网':'https://search.cctv.com/search.php?qtext={kw}&type=web',
  '抖音':'https://www.douyin.com/search/{kw}',
  '快手':'https://www.kuaishou.com/search/video?searchKey={kw}',
  '腾讯微视':'https://weishi.qq.com/search?keyword={kw}',
  '豆瓣电影':'https://search.douban.com/movie/subject_search?search_text={kw}',
  '猫眼电影':'https://m.maoyan.com/apollo/search?query={kw}',
  '斗鱼':'https://www.douyu.com/search?kw={kw}',
  '虎牙直播':'https://www.huya.com/search?kw={kw}',
  '找剧AI':'https://zhaoju4.com/search?keyword={kw}',
  '红果短剧':'https://hongguoduanju.com/search?keyword={kw}'
};
function platformKw(cat){
  for(var i=0;i<PLATFORM_CATS.length;i++) if(PLATFORM_CATS[i].cat === cat) return PLATFORM_CATS[i].kw;
  return cat || '电影';
}
/* 生成某平台某关键词的官方资源入口；无模板时降级到平台首页 */
function platformUrl(name, kw){
  var t = SEARCH_TPL[name];
  if(t) return t.replace('{kw}', encodeURIComponent(kw));
  for(var i=0;i<BUILTIN_SITES.length;i++) if(BUILTIN_SITES[i].name === name) return BUILTIN_SITES[i].url;
  return 'https://www.bilibili.com';
}
function platformSearchCount(){
  var n = 0;
  for(var k in SEARCH_TPL){ if(Object.prototype.hasOwnProperty.call(SEARCH_TPL,k) && SEARCH_TPL[k]) n++; }
  return n;
}
/* 取 URL 域名，用于平台入口的简洁副标题（完整地址放 title 与复制） */
function hostOf(u){
  try{ return new URL(u).host; }catch(e){ return String(u || '').slice(0, 30); }
}
/* 平台入口副标题：分类直达显示「域名 · 检索「关键词」」，无模板的显示官方首页 */
function platformSub(name, purl, kw){
  return hostOf(purl) + ' · ' + (SEARCH_TPL[name] ? '检索「' + kw + '」' : '官方首页');
}
/* ---- 平台打开方式（1.6.0）----
   桌面 UA 在 1905 / 猫眼 / YY 上会被 403 / 403 / 436 拒绝，移动 UA 才是 200；
   因此每个平台带一个 UA 模式，原生网页页据此设 User-Agent。 */
function siteByName(name){
  for(var i=0;i<BUILTIN_SITES.length;i++) if(BUILTIN_SITES[i].name === name) return BUILTIN_SITES[i];
  return null;
}
function platMode(s){
  var m = s && s.mode;
  return (m && PLAT_MODE[m]) ? m : 'pc';
}
function platDirect(s){ return !!PLAT_MODE[platMode(s)].direct; }
/* 官网入口默认落地地址：优先实测可用的移动 H5 */
function platOpenUrl(s){
  if(s && typeof s.mobile === 'string' && /^https?:\/\//i.test(s.mobile)) return s.mobile;
  return s ? s.url : '';
}
/* 官网入口的 UA / 打开模式：完整传给原生网页页，oversea / project 只用于显示提示 */
function platEntryMode(s){
  return platMode(s);
}
/* 分类检索页的 UA：m.* 域用移动 UA，其余统一桌面 UA（检索页多为 PC 站） */
function platSearchMode(name, purl){
  try{ if(/^m\./i.test(new URL(purl).hostname)) return 'wap'; }catch(e){}
  return 'pc';
}
function platBadge(s){
  var m = platMode(s), c = PLAT_MODE[m];
  var cls = m === 'wap' ? 'wap' : (m === 'pc' ? 'pc' : 'warn');
  return '<span class="pmode ' + cls + '" title="' + esc(c.hint) + '">' + c.label + '</span>';
}
/* 可直接打开的排前面，受限站点自动沉底；「按可播率」时先按 7 天实测可播率再按直达 */
function platSorted(list){
  var byRate = state.platSort === 'rate';
  return list.slice().sort(function(a,b){
    if(byRate){
      var ra = khPlatRate(a.name), rb = khPlatRate(b.name);
      if(rb - ra > 0.0001) return 1;
      if(ra - rb > 0.0001) return -1;
    }
    var d = (platDirect(b) ? 1 : 0) - (platDirect(a) ? 1 : 0);
    return d;
  });
}
/* 平台可播率：本机按天累计探测结果，保留最近 7 天（不伪造全网热度，只报本机实测） */
var PLAT_HIST_KEY = 'kh_plat_hist';
function khPlatHistAll(){ try{ return getStore(PLAT_HIST_KEY, {}) || {}; }catch(e){ return {}; } }
function khPlatHistAdd(name, ok){
  try{
    var all = khPlatHistAll();
    var day = new Date().toISOString().slice(0, 10);
    var rec = all[name] || {};
    var d = rec[day] || { ok: 0, bad: 0 };
    if(ok) d.ok = (d.ok || 0) + 1; else d.bad = (d.bad || 0) + 1;
    rec[day] = d;
    /* 只保留 7 天，避免 208 平台 × 无限天数把本地存储撑爆 */
    var days = Object.keys(rec).sort().slice(-7);
    var slim = {}; for(var i=0;i<days.length;i++) slim[days[i]] = rec[days[i]];
    all[name] = slim;
    setStore(PLAT_HIST_KEY, all);
  }catch(e){}
}
function khPlatRate(name){
  try{
    var rec = khPlatHistAll()[name] || {};
    var ok = 0, bad = 0;
    for(var k in rec){ if(Object.prototype.hasOwnProperty.call(rec, k)){ ok += rec[k].ok || 0; bad += rec[k].bad || 0; } }
    var total = ok + bad;
    if(!total) return -1;                 /* 无数据：不参与排序，也不显示假百分比 */
    return ok / total;
  }catch(e){ return -1; }
}
function khPlatRateLabel(name){
  var r = khPlatRate(name);
  if(r < 0) return '';
  var pct = Math.round(r * 100);
  var cls = pct >= 70 ? 'ok' : (pct >= 40 ? 'ping' : 'down');
  return '<span class="pdot ' + cls + '" title="本机最近 7 天实测可播率 ' + pct + '%（' +
    ((khPlatHistAll()[name] && Object.keys(khPlatHistAll()[name]).length) || 0) + ' 天数据）"></span>' +
    '<span style="color:#8A8FA3;font-size:11.5px;margin-left:4px">' + pct + '%</span>';
}

/* ---------------- 红果 / 找剧AI 一键直达（云端清单可热更新） ----------------
   红果官方网页版 hongguoduanju.com（novelquickapp.com 会 302 到此，直接用落地域名避免重定向循环）。
   hgDetail 指向当日热播剧的播放页，由工程流水线每次发版时从官网抓取后写进云端清单。 */
var KH_QUICK_DEFAULT = {
  hgHome:'https://hongguoduanju.com/',
  hgRank:'https://hongguoduanju.com/rank/hot-drama',
  hgDetail:'https://hongguoduanju.com/detail?series_id=7705741128217152574',
  zjHome:'https://zhaoju4.com/',
  zjSearch:'https://zhaoju4.com/search'
};
window.KH_QUICK = null;
function khQuick(){ return window.KH_QUICK || KH_QUICK_DEFAULT; }

/* ---------------- 问题中心 · 自动收集（1.7.0） ----------------
   统一收集脚本 / 资源 / 播放 / 异步 / 平台巡检 / 片源 / 清单 / 升级 / 兼容 /
   原生网页页回流等异常，本地环形持久化（最多 300 条）、60 秒同类去重、分级统计。
   数据只存本机、不上传，不含账号与片源内容；「问题」页可一键复制诊断报告。 */
var ISSUE_KEY = 'kh_issues_v1';
var ISSUE_CFG_KEY = 'kh_issue_cfg_v1';
var ISSUE_MAX = 300;
var ISSUE_MERGE_MS = 60000;
var ISSUE_KINDS = {'脚本':'error','资源':'warn','播放':'error','异步':'error','渲染':'error',
  '平台':'warn','源':'warn','清单':'warn','升级':'warn','兼容':'warn',
  '网页':'error','自检':'info','网络':'warn'};
/* 风暴保护：同一类别 1 小时内累计超过该值后只加计数，不再新增条目 */
var ISSUE_KIND_HOURLY = 120;
/* 每日外发上限：非手动触发的自动上报一天最多这么多条，超限静默到次日；
   手动「立即上报」不受限，避免客户想反馈却被拦住。 */
var ISSUE_DAILY_MAX = 50;
function issueCfg(){
  var c = getStore(ISSUE_CFG_KEY, null);
  if(!c || typeof c !== 'object') c = {auto:true, createdAt:Date.now()};
  return {auto: c.auto !== false, createdAt: c.createdAt || 0};
}
function saveIssueCfg(c){ setStore(ISSUE_CFG_KEY, c); }
function issueList(){ var v = getStore(ISSUE_KEY, []); return Array.isArray(v) ? v : []; }
function issueSev(kind){ return ISSUE_KINDS[kind] || 'warn'; }
function issueDevice(){
  var d = window.KH_DEVICE;
  if(!d) return '浏览器预览';
  return (d.marketName || d.deviceType || '未知设备') + ' / ' + (d.osFullName || '开鸿') +
         ' API' + (d.apiVersion || '?') + ' / ' + (d.tier || 'mid') + '档 / v' + (d.appVersion || '?');
}
function issueVer(){
  try{
    var d = window.KH_DEVICE || {};
    var v = d.appVersion || d.appCode || (typeof KH_APP_CODE !== 'undefined' ? KH_APP_CODE : '') || '?';
    return String(v).slice(0, 12);
  }catch(e){ return '?'; }
}
function issuePlat(){
  try{
    if(window.KH_HARMONY) return 'hap';
    if(window.KH_DESKTOP) return 'desktop';
    return 'web';
  }catch(e){ return 'web'; }
}
/* 当日计数，键随日期滚动，跨天自动归零 */
function issueDaily(){
  var day = new Date().toISOString().slice(0, 10);
  var d = getStore('kh_issue_daily_v1', null);
  if(!d || typeof d !== 'object' || d.day !== day) d = {day: day, n: 0};
  return d;
}
/* 外发 URL 再脱敏一层：去掉 query 里的签名 / token 键，路径只留到 160 字 */
function issueSafeUrl(u){
  try{
    var x = new URL(String(u));
    var banned = /^(token|auth|auth_key|authkey|sign|signature|sig|key|api_key|apikey|access_token|secret|password|pwd|expires|st|wssecret|wstime|e)$/i;
    var qs = [];
    x.searchParams.forEach(function(v, k){
      if(banned.test(k)) return;
      qs.push(k + '=' + (String(v).length > 12 ? '[v]' : v));
    });
    return (x.origin + x.pathname).slice(0, 160) + (qs.length ? '?' + qs.slice(0, 3).join('&') : '');
  }catch(e){ return String(u || '').slice(0, 80).replace(/[?&#].*$/, ''); }
}
function issuePush(kind, msg, extra){
  try{
    if(!issueCfg().auto) return;
    var text = String(msg === undefined ? '' : msg).replace(/\s+/g, ' ').slice(0, 240);
    if(!text) return;
    var view = (typeof state !== 'undefined' && state) ? state.view : 'boot';
    var host = (extra && extra.url) ? hostOf(extra.url) : '';
    /* 指纹：类别|错误码|页面|域名|版本|平台|文案前 80 字。
       带版本才能判断「新版是否已修好」，带平台才能区分桌面 / HAP / 网页。 */
    var ver = issueVer(), plat = issuePlat();
    var key = kind + '|' + String((extra && extra.code) || '') + '|' + view + '|' + host + '|' + ver + '|' + plat + '|' + text.slice(0, 80);
    var now = Date.now(), list = issueList(), hit = null;
    for(var i=0;i<list.length && i<40;i++){
      if(list[i].key === key && now - (list[i].ts || 0) < ISSUE_MERGE_MS){ hit = list[i]; break; }
    }
    if(hit){
      hit.n = (hit.n || 1) + 1; hit.ts = now; hit.lastTs = now;
      if(!hit.firstTs) hit.firstTs = hit.ts;
      if(extra && extra.url) hit.url = issueSafeUrl(extra.url);
    } else {
      var sameKind = 0;
      for(var j=0;j<list.length;j++){ if(list[j].kind === kind && now - (list[j].ts || 0) < 3600000) sameKind += (list[j].n || 1); }
      if(sameKind >= ISSUE_KIND_HOURLY){
        for(var m=0;m<list.length;m++){ if(list[m].kind === kind){ list[m].n = (list[m].n || 1) + 1; list[m].ts = now; list[m].lastTs = now; break; } }
        setStore(ISSUE_KEY, list);
        return;
      }
      var row = {key:key, ts:now, firstTs:now, lastTs:now, kind:kind, msg:text, n:1, sev:issueSev(kind),
                 view:view, dev:issueDevice(), ver:ver, plat:plat};
      if(extra && extra.code !== undefined) row.code = String(extra.code).slice(0, 20);
      if(extra && extra.url) row.url = issueSafeUrl(extra.url);
      if(extra && extra.lv !== undefined) row.lv = Math.max(0, Number(extra.lv) || 0);
      if(extra && extra.live) row.live = true;
      if(extra && extra.buf !== undefined) row.buf = Math.max(0, Math.round(Number(extra.buf) || 0));
      list.unshift(row);
      if(list.length > ISSUE_MAX) list.length = ISSUE_MAX;
    }
    setStore(ISSUE_KEY, list);
    if(issueSev(kind) === 'error') issueRemoteMaybe();
    /* 正在问题页时不打断操作，延后重绘 */
    if(typeof state !== 'undefined' && state && state.view === 'issues' && typeof render === 'function'){
      clearTimeout(state.issuePaintTimer);
      state.issuePaintTimer = setTimeout(render, 800);
    }
  }catch(e){}
}
window.__khIssue = issuePush;
/* 原生网页页（ArkWeb）加载失败写进 AppStorage 队列，返回影站后由桥接拉回 */
window.__khPushNativeIssues = function(txt){
  try{
    var arr = JSON.parse(txt);
    if(!Array.isArray(arr)) return;
    for(var i=0;i<arr.length && i<40;i++){
      var f = String(arr[i] || '').split('\u0002');
      issuePush(f[0] || '网页', (f[1] ? '[' + f[1] + '] ' : '') + (f[2] || '网页加载失败'),
                {code:f[1] || '', url:f[3] || ''});
    }
  }catch(e){}
};
function pullNativeIssues(){
  try{
    if(window.KaihongBridge && typeof window.KaihongBridge.pullIssues === 'function'){
      window.KaihongBridge.pullIssues();
    }
  }catch(e){}
}
function issueStats(){
  var list = issueList(), now = Date.now(), day = 0, byKind = {}, byMsg = {};
  for(var i=0;i<list.length;i++){
    var it = list[i];
    if(now - (it.ts||0) < 86400000) day += (it.n || 1);
    byKind[it.kind] = (byKind[it.kind] || 0) + (it.n || 1);
    byMsg[it.key] = (byMsg[it.key] || 0) + (it.n || 1);
  }
  var top = [];
  for(var k in byMsg){ if(Object.prototype.hasOwnProperty.call(byMsg,k)) top.push({key:k, n:byMsg[k]}); }
  top.sort(function(a,b){ return b.n - a.n; });
  return {total:list.length, day:day, kinds:byKind, top:top.slice(0,8)};
}
function issueTotalCount(){
  var l = issueList(), n = 0;
  for(var i=0;i<l.length;i++) n += (l[i].n || 1);
  return n;
}
/* 自动体检：启动后 3.5 秒一次，之后每 10 分钟随源清单刷新复检 */
function runIssueSelfCheck(manual){
  try{
    var st = srcHealthStat(), m = srcMeta();
    var line = '资源 ' + allMovies().length + ' 部 / 直播 ' + LIVE_CHANNELS.length +
      ' 频道 / 源清单 v' + (m.v || 0) + ' / 平台 ' + BUILTIN_SITES.length +
      ' / 可用线路 ' + st.good + ' 降权 ' + st.bad + ' / 已记录问题 ' + issueTotalCount() + ' 次';
    issuePush('自检', (manual ? '手动体检：' : '自动体检：') + line);
    if(st.bad >= 5) issuePush('自检', '降权线路较多（' + st.bad + ' 条），建议检查网络或刷新源清单');
    var rel = window.KH_RELEASE && window.KH_RELEASE.latest, dev = window.KH_DEVICE;
    if(rel && dev && Number(dev.apiVersion) > 0 && Number(dev.apiVersion) < Number(rel.minApi)){
      issuePush('兼容', '系统 API' + dev.apiVersion + ' 低于最低要求 API' + rel.minApi);
    }
    if(manual && typeof toast === 'function') toast('体检完成：' + line);
  }catch(e){}
  pullNativeIssues();
  issueRemoteSend(false);
  if(manual && typeof render === 'function') render();
}
function issueReport(){
  var s2 = issueStats(), st = srcHealthStat(), m = srcMeta(), lines = [];
  lines.push('鸿汇影 · 问题诊断报告');
  lines.push('生成时间：' + new Date().toLocaleString('zh-CN', {hour12:false}));
  lines.push('设备：' + issueDevice());
  lines.push('应用：v' + ((window.KH_DEVICE && window.KH_DEVICE.appVersion) || '?') +
             ' / 源清单 v' + (m.v || 0) + ' / 云端 ' +
             ((window.KH_RELEASE && window.KH_RELEASE.latest && window.KH_RELEASE.latest.versionName) || '未知'));
  lines.push('规模：' + allMovies().length + ' 部资源 / ' + LIVE_CHANNELS.length + ' 频道 / ' +
             BUILTIN_SITES.length + ' 平台 / 可用线路 ' + st.good + ' 降权 ' + st.bad);
  lines.push('问题：共 ' + issueTotalCount() + ' 次 / 近 24 小时 ' + s2.day + ' 次 / 去重 ' + s2.total + ' 条');
lines.push('启动耗时：' + (Number(getStore('kh_boot_ms', 0)) || 0) + ' ms（脚本就绪到首屏渲染完成）');
  lines.push('播放：兼容模式 ' + (state.compatMode ? '开' : '关') +
    ' · 响度均衡 ' + (state.loudnessEq ? (state.audioGraph ? '开（已接音频图）' : '开（待播放接入）') : '关'));
  var _ps = state.playStats || {};
  lines.push('本次播放：首帧 ' + (_ps.firstFrameMs ? _ps.firstFrameMs + ' ms' : '未起播') +
    ' · 缓冲 ' + (_ps.buffering || 0) + ' 次 · 降档 ' + (_ps.downgrades || 0) + ' 次 · 切源 ' + (_ps.sourceSwitches || 0) + ' 次');
  if(window.KH_ENV_INFO){
    var _ei = window.KH_ENV_INFO;
    var _disk = _ei.diskFreeBytes == null ? '未知' : (Math.round(_ei.diskFreeBytes / 1024 / 1024) + 'MB 可用');
    lines.push('环境：硬件加速 ' + (_ei.disableGpu ? '已关闭（软渲染）' : '默认') +
      ' · 数据目录 ' + (_ei.writeOk === true ? '可写' : (_ei.writeOk === false ? '不可写' : '未知')) +
      (_ei.portsExhausted ? ' · 端口曾全部占用' : '') +
      ' · 系统 ' + (_ei.platform || '?') + ' ' + (_ei.sysVersion || '?') + (_ei.oldSystem ? '（版本偏低，可能不兼容）' : '') +
      ' · 磁盘 ' + _disk + (_ei.diskOk === false ? '（空间紧张）' : ''));
  }
  /* 本机桥能力（#118）：标注桌面 Electron 桥是否就绪；纯网页 / HAP 为无桥环境，如实呈现 */
  try{
    var _bridges = [
      ['外部播放器', !!window.khExternal],
      ['系统通知', !!window.khNotify],
      ['下载进度', !!window.khDownload],
      ['媒体快捷键', !!window.khShortcut]
    ];
    lines.push('本机桥：' + _bridges.map(function(b){ return b[0] + (b[1] ? ' 可用' : ' 不可用'); }).join(' · '));
  }catch(e){}
  /* 升级链路状态并入诊断报告（#104）：当前阶段 + 最近一次升级尝试 */
  try{
    var _up = window.KH_UPGRADE;
    var _att = getStore('kh_upgrade_attempt', null);
    if(_up || _att){
      lines.push('---- 升级 ----');
      if(_up){
        var _ulabel = KH_UPGRADE_STAGES[_up.stage] || _up.stage || '?';
        lines.push('当前阶段：' + _ulabel + ' · ' + esc(String(_up.message || '')) +
          (_up.percent ? ' · ' + _up.percent + '%' : '') +
          (_up.failKind ? ' · 失败归类 ' + _up.failKind : ''));
      }
      if(_att && _att.from != null){
        lines.push('上次尝试：从 #' + _att.from + ' · ' +
          new Date(Number(_att.at)).toLocaleString('zh-CN',{hour12:false}) + ' · ' + (_att.kind || 'install'));
      }
    }
  }catch(e){}
  if(window.KH_CRASH_LOG && window.KH_CRASH_LOG.length){
    lines.push('---- 本机崩溃 / 异常（最近 ' + window.KH_CRASH_LOG.length + ' 条）----');
    for(var ci=0; ci<window.KH_CRASH_LOG.length && ci<10; ci++){
      var cr = window.KH_CRASH_LOG[ci];
      lines.push(new Date(cr.ts).toLocaleString('zh-CN', {hour12:false}) + ' [' + cr.kind + '] ×' + (cr.n||1) + ' ' + cr.reason);
    }
  }
  lines.push('---- 高频问题 ----');
  for(var i=0;i<s2.top.length;i++){
    var kp = s2.top[i].key.split('|');
    lines.push((i+1) + '. [' + kp[0] + '] ×' + s2.top[i].n + ' ' + kp.slice(1).join('|'));
  }
  if(!s2.top.length) lines.push('（暂无记录）');
  lines.push('---- 最近明细（最多 30 条）----');
  var list = issueList();
  for(var j=0;j<list.length && j<30;j++){
    var it = list[j];
    lines.push(new Date(it.ts).toLocaleString('zh-CN', {hour12:false}) + ' [' + it.kind + ']' +
      (it.code ? '(' + it.code + ')' : '') + ' ×' + (it.n||1) + ' ' + it.msg +
      (it.url ? ' @ ' + it.url : ''));
  }
  lines.push('说明：数据仅存本机，不含账号与片源内容。');
  return lines.join('\n');
}
function copyIssueText(txt, label){
  var ok = false;
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt); ok = true; }
  }catch(e){}
  if(!ok){
    try{
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    }catch(e2){}
  }
  toast(ok ? (label || '报告') + '已复制，可粘贴反馈' : '复制失败，请长按下方文本框手动复制');
  return ok;
}
/* 诊断报告导出文件（#96）：Blob 下载 .txt / .json；环境不支持下载时回退复制文本 */
function downloadTextFile(name, text, mime){
  /* 第十一轮：设备端（HAP/ArkWeb）没有下载目录，Blob + <a download> 静默无效，
     以前只能退回「复制到剪贴板」。接上原生文件桥后优先选路径落盘。 */
  if(window.khFile && typeof window.khFile.saveText === 'function'){
    try{
      window.khFile.saveText(name, text).then(function(r){
        if(r && r.ok){ toast('已保存：' + (r.path || name)); return; }
        if(r && r.reason === '已取消') return;
        toast('保存失败：' + ((r && r.reason) || '未知原因'));
      });
      return true;
    }catch(e){}
  }
  try{
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ try{ URL.revokeObjectURL(url); a.remove(); }catch(e){} }, 300);
    return true;
  }catch(e){ return false; }
}
function issueFileName(ext){
  var d = new Date(), pad = function(n){ return String(n).padStart(2, '0'); };
  return 'honghub-diagnostic-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.' + ext;
}

/* ---------------- 远程收集 · 问题自动上报（1.7.0） ----------------
   默认端点由发版流水线写入 ISSUE_REMOTE_DEFAULT；用户可在问题中心改成自己的接口。
   只上报脱敏摘要 + 匿名设备 ID，本地完整记录始终保留，可随时暂停。 */
var ISSUE_REMOTE_KEY = 'kh_issue_remote_v1';
var ISSUE_REMOTE_DEFAULT = (function(){ try { var h = localStorage.getItem('khHub') || 'http://192.168.188.152:8787'; return h ? (h.replace(/\/+$/,'') + '/api/report') : ''; } catch(e){ return ''; } })();
window.KH_HARMONY = true;
var ISSUE_REMOTE_LAST_TRY = 0;
function issueRemoteCfg(){
  var c = getStore(ISSUE_REMOTE_KEY, null);
  if(!c || typeof c !== 'object') c = {};
  return {
    /* 1.7.107：默认开启（含客户纯净版），用户点关闭后记 enabled=false 才停发。
       1.7.108 商店变体（KH_STORE）：默认关闭，用户主动点开（enabled===true）才发——
       上架审核口径，隐私政策同步声明。只外发脱敏摘要，不含账号、片源与完整 URL。 */
    enabled: window.KH_STORE ? (c.enabled === true && !window.KH_LIMITED) : (c.enabled !== false),
    /* url：用户手填的优先；否则用清单下发的（1.7.106：客户版也收）。开发端没人下发时回落同源
       /api/report；客户版不回落——空着比指向本机自己更清楚，点了开关会提示「请先填写远程收集地址」，
       不会白攒一堆「上次失败」。商店变体只认用户手填，不接受任何预置/下发地址。 */
    url: (typeof c.url === 'string' && /^https?:\/\//i.test(c.url)) ? c.url
       : (window.KH_STORE ? ''
          : (/^https?:\/\//i.test(ISSUE_REMOTE_DEFAULT) ? ISSUE_REMOTE_DEFAULT
             : (window.KH_UI_CLEAN ? '' : ISSUE_REMOTE_DEFAULT))),
    lastAt: c.lastAt || 0, sent: c.sent || 0, fails: c.fails || 0,
    err: typeof c.err === 'string' ? c.err : ''
  };
}
function issueDeviceId(){
  var v = getStore('kh_issue_devid', '');
  if(!v || typeof v !== 'string'){
    v = 'kh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    setStore('kh_issue_devid', v);
  }
  /* 同步给主进程：崩溃上报复用同一 ID，才能把崩溃与页面错误串成一台设备 */
  if(!issueDeviceId._sent && window.khDeviceIdBridge && typeof window.khDeviceIdBridge.set === 'function'){
    try{ window.khDeviceIdBridge.set(v); issueDeviceId._sent = true; }catch(e){}
  }
  return v;
}
/* 消息里的完整 URL 只保留域名，避免把片源直链 / 带 token 的地址发到远端 */
function issueSanitize(t){
  return String(t || '').replace(/https?:\/\/[^\s'"<>]+/gi, function(m){
    try{ return new URL(m).hostname; }catch(e){ return '[url]'; }
  }).replace(/(\+?86)?1[3-9]\d{9}/g, '[phone]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[mail]')
    .slice(0, 240);
}
function issueRemoteIncrement(){
  var c = issueRemoteCfg(), list = issueList(), out = [];
  for(var i=0;i<list.length && i<80;i++){
    var it = list[i];
    if((it.ts || 0) < c.lastAt) continue;
    out.push({kind:it.kind, sev:it.sev, code:it.code || '', msg:issueSanitize(it.msg),
              n:it.n || 1, ts:it.ts, firstTs:it.firstTs || it.ts, lastTs:it.lastTs || it.ts,
              view:it.view || '', host:it.url ? hostOf(it.url) : '',
              ver:it.ver || issueVer(), plat:it.plat || issuePlat(),
              lv:it.lv || 0, live:!!it.live, buf:it.buf || 0});
  }
  return out;
}
function issueRemoteDone(at, n, via){
  var c = issueRemoteCfg();
  c.lastAt = at; c.sent = (c.sent || 0) + n; c.fails = 0; c.err = '';
  setStore(ISSUE_REMOTE_KEY, c);
  var d = issueDaily(); d.n = (d.n || 0) + n; setStore('kh_issue_daily_v1', d);
  setStore('kh_issue_pending_v1', null);
  window.KH_REMOTE_STATE = {ok:true, at:at, n:n, via:via || 'web'};
  if(typeof state !== 'undefined' && state && state.view === 'issues' && typeof render === 'function') render();
}
function issueRemoteFail(msg){
  var c = issueRemoteCfg();
  c.fails = (c.fails || 0) + 1; c.err = String(msg).slice(0, 120);
  setStore(ISSUE_REMOTE_KEY, c);
  /* 离线补发：记下待发水位，下次启动或恢复后重试 */
  setStore('kh_issue_pending_v1', {since: c.lastAt || 0, at: Date.now(), fails: c.fails});
  if(typeof state !== 'undefined' && state && state.view === 'issues' && typeof render === 'function') render();
}
window.__khRemoteState = function(txt){
  try{
    var r = (typeof txt === 'string') ? JSON.parse(txt) : txt;
    if(r && r.ok) issueRemoteDone(r.at || Date.now(),
      Number(window.KH_REMOTE_PENDING_N || r.n || 0), 'native');
    else issueRemoteFail((r && r.error) || '原生上报失败');
  }catch(e){ issueRemoteFail('上报状态解析失败'); }
};
function issueRemoteSend(manual){
  var c = issueRemoteCfg();
  if(!c.enabled){ if(manual) toast('远程收集已暂停'); return; }
  if(!c.url){ if(manual) toast('请先填写远程收集地址'); return; }
  var inc = issueRemoteIncrement();
  if(!inc.length && !manual) return;
  /* 每日上限只约束自动上报；手动立即上报始终放行 */
  if(!manual && inc.length){
    var dl = issueDaily();
    if((dl.n || 0) >= ISSUE_DAILY_MAX) return;
    if((dl.n || 0) + inc.length > ISSUE_DAILY_MAX) inc = inc.slice(0, ISSUE_DAILY_MAX - (dl.n || 0));
  }
  var st = srcHealthStat(), m = srcMeta(), at = Date.now();
  var body = JSON.stringify({
    schema:1, app:'HongHubMovie', deviceId:issueDeviceId(),
    version:(window.KH_DEVICE && window.KH_DEVICE.appVersion) || '?',
    device:issueDevice(), sentAt:at,
    summary:{total:issueTotalCount(), day:issueStats().day,
             channels:LIVE_CHANNELS.length, platforms:BUILTIN_SITES.length,
             manifest:m.v || 0, good:st.good, bad:st.bad},
    issues:inc
  });
  window.KH_REMOTE_PENDING_N = inc.length;
  if(manual) toast('正在上报 ' + inc.length + ' 条问题摘要…');
  /* 真机走原生 HTTP，避免 file:// 页面的 CORS / 混合内容限制 */
  if(window.KaihongBridge && typeof window.KaihongBridge.reportIssues === 'function'){
    try{ window.KaihongBridge.reportIssues(c.url, body); return; }
    catch(e){ issueRemoteFail('原生通道不可用，改用网页通道'); }
  }
  try{
    var ac = (typeof AbortController === 'function') ? new AbortController() : null;
    var tm = ac ? setTimeout(function(){ try{ ac.abort(); }catch(e){} }, 8000) : null;
    fetch(c.url, {method:'POST', cache:'no-store', signal: ac ? ac.signal : undefined,
      headers:{'Content-Type':'application/json'}, body:body})
      .then(function(r){
        if(tm) clearTimeout(tm);
        if(!r.ok) throw new Error('HTTP ' + r.status);
        issueRemoteDone(at, inc.length, 'web');
      })
      .catch(function(e){
        if(tm) clearTimeout(tm);
        issueRemoteFail(e && e.message ? e.message : '网络不可达');
      });
  }catch(e){ issueRemoteFail(e && e.message ? e.message : '请求发起失败'); }
}
function issueRemoteMaybe(){
  var c = issueRemoteCfg(), now = Date.now();
  if(!c.enabled || !c.url) return;
  /* 失败退避：30s → 2m → 10m → 1h 封顶，成功清零；服务端临时故障不再持续打 */
  var wait = [30000, 120000, 600000, 3600000][Math.min(3, c.fails || 0)];
  if(now - ISSUE_REMOTE_LAST_TRY < wait) return;
  ISSUE_REMOTE_LAST_TRY = now;
  setTimeout(function(){ issueRemoteSend(false); }, 1500);
}

/* ---------------- 平台入口实时巡检 ---------------- */
/* no-cors 探测只能判断网络层可达（DNS / 连接 / 服务器响应），
   不能读取状态码（浏览器跨域限制）；结果仅作入口健康参考。 */
var PLAT_HEALTH = {};
var PLAT_PROBE_AT = 0;
function probePlatforms(force){
  var now = Date.now();
  if(!force && now - PLAT_PROBE_AT < 300000) return;   // 结果缓存 5 分钟
  PLAT_PROBE_AT = now;
  /* 海外站(oversea)与只读项目页(project)本就预期受网络/地区限制，
     国内网络下 fetch 必然超时。对它们不做可达探测，也不发"不可达"告警，
     统一标记 limited（中性），避免把正常海外站误报成故障。 */
  var pending = 0;
  for(var i=0;i<BUILTIN_SITES.length;i++){
    var s0 = BUILTIN_SITES[i];
    if(!platDirect(s0)){ PLAT_HEALTH[s0.name] = 'limited'; continue; }
    pending++;
  }
  if(pending <= 0){ if(state.view === 'sites') render(); return; }
  function done(){ pending--; if(pending <= 0 && state.view === 'sites') render(); }
  for(var j=0;j<BUILTIN_SITES.length;j++){
    (function(s){
      if(!platDirect(s)) return;
      var key = s.name;
      PLAT_HEALTH[key] = 'ping';
      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var timer = setTimeout(function(){ if(ctl) ctl.abort(); }, 9000);
      fetch(platOpenUrl(s), {mode:'no-cors', cache:'no-store', signal: ctl ? ctl.signal : undefined})
        .then(function(){ clearTimeout(timer); PLAT_HEALTH[key] = 'ok'; khPlatHistAdd(key, true); done(); })
        .catch(function(){
          clearTimeout(timer); PLAT_HEALTH[key] = 'down'; khPlatHistAdd(key, false);
          issuePush('平台', '入口探测不可达：' + key, {url:platOpenUrl(s)});
          done();
        });
    })(BUILTIN_SITES[j]);
  }
}
function platHealthDot(name){
  var v = PLAT_HEALTH[name];
  if(v === 'ok') return '<span class="pdot ok" title="实时巡检：网络可达"></span>';
  if(v === 'down') return '<span class="pdot down" title="实时巡检：探测不可达，入口仍可尝试打开"></span>';
  if(v === 'ping') return '<span class="pdot ping" title="巡检中…"></span>';
  if(v === 'limited') return '<span class="pdot ping" title="海外站/只读页：受网络或地区限制，建议系统浏览器打开"></span>';
  return '';
}
function platHealthSummary(){
  var ok = 0, down = 0, limited = 0;
  for(var i=0;i<BUILTIN_SITES.length;i++){
    var v = PLAT_HEALTH[BUILTIN_SITES[i].name];
    if(v === 'ok') ok++; else if(v === 'down') down++; else if(v === 'limited') limited++;
  }
  if(!ok && !down && !limited) return '尚未巡检';
  return '实时巡检：' + ok + ' 可达' + (down ? ' / ' + down + ' 不可达' : '') +
    (limited ? ' / ' + limited + ' 海外站需浏览器' : '');
}

/* ---------------- 远程配置 · 实时同步 ---------------- */
/* 用户可配置自己的 JSON 数据源，应用拉取最新的网站 / 影视资源（直链片源）/
   直播频道清单并幂等合并进本地；开启自动同步后每 10 分钟刷新。
   接口需允许跨域（CORS）。应用不抓取、不缓存第三方版权内容。 */
function getRemoteCfg(){
  var v = getStore('kh_remote', null);
  if(!v || typeof v !== 'object') v = {};
  return {
    url: typeof v.url === 'string' ? v.url : '',
    auto: !!v.auto, last: v.last || 0, lastOk: v.lastOk || 0,
    added: v.added || 0, err: typeof v.err === 'string' ? v.err : ''
  };
}
function saveRemoteCfg(c){ setStore('kh_remote', c); }
function remoteStatusLine(c){
  if(c.err) return '<span class="syncstat err">最近同步失败：' + esc(String(c.err).slice(0, 60)) + '</span>';
  if(c.lastOk) return '<span class="syncstat ok">最近同步 ' + new Date(c.lastOk).toLocaleTimeString('zh-CN', {hour12:false}) + ' · 累计新增 ' + (c.added || 0) + ' 条</span>';
  return '<span class="syncstat">尚未同步</span>';
}
function remoteFetchAndApply(url, silent){
  var c = getRemoteCfg();
  c.url = url; c.err = '';
  var ctl = ('AbortController' in window) ? new AbortController() : null;
  var timer = setTimeout(function(){ if(ctl) ctl.abort(); }, 15000);
  fetch(url, {cache:'no-store', signal: ctl ? ctl.signal : undefined})
    .then(function(r){
      clearTimeout(timer);
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data){ clearTimeout(timer); applyRemoteData(data, c, silent); })
    .catch(function(e){
      clearTimeout(timer);
      c.last = Date.now();
      c.err = '同步失败：' + (e && e.message ? e.message : '网络或 CORS 限制');
      saveRemoteCfg(c);
      if(!silent) toast(c.err);
      if(state.view === 'sites') render();
    });
}
function syncRemoteNow(){
  var input = document.getElementById('remoteUrl');
  var url = input ? input.value.trim() : getRemoteCfg().url;
  if(url && !/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
  if(!url){ toast('请先填写配置 JSON 的网址'); return; }
  if(input) input.value = url;
  toast('正在拉取远程配置…');
  remoteFetchAndApply(url, false);
}
function applyRemoteData(data, c, silent){
  if(!data || typeof data !== 'object'){ c.err = '配置格式错误：根节点应为 JSON 对象'; saveRemoteCfg(c); toast(c.err); return; }
  var added = 0;
  /* 1. 网站 */
  var sites = Array.isArray(data.sites) ? data.sites : [];
  var slist = getSites();
  for(var i=0;i<sites.length && slist.length < 50;i++){
    var s = sites[i];
    if(!s || typeof s.name !== 'string' || !s.name.trim()) continue;
    var u = normalizeSiteUrl(String(s.url || ''));
    if(!u) continue;
    var dup = false;
    for(var j=0;j<slist.length;j++) if(slist[j].url === u){ dup = true; break; }
    if(!dup) for(var b=0;b<BUILTIN_SITES.length;b++) if(BUILTIN_SITES[b].url === u){ dup = true; break; }
    if(dup) continue;
    slist.push({name:String(s.name).trim().slice(0,20), url:u, color:'#3B456B', tag:String(s.name).trim().slice(0,1)});
    added++;
  }
  setStore('kh_sites', slist.slice(0,50));
  /* 2. 影视资源（直链片源） */
  var res = Array.isArray(data.resources) ? data.resources : [];
  var rlist = getRes();
  for(var k=0;k<res.length && rlist.length < 50;k++){
    var r = res[k];
    if(!r || typeof r.title !== 'string' || !r.title.trim()) continue;
    var urls = [];
    var raw = (r.urls && Array.isArray(r.urls)) ? r.urls : (r.url ? [r.url] : []);
    for(var m=0;m<raw.length && m<3;m++){
      var ru = normalizeResUrl(raw[m]);
      if(ru && urls.indexOf(ru) < 0) urls.push(ru);
    }
    if(!urls.length) continue;
    var item = makeRes(r.title, (typeof r.subtitle === 'string' && r.subtitle) ? r.subtitle : '远程同步资源', r.category, urls);
    item.desc = '远程配置实时同步的片源，共 ' + urls.length + ' 路，可自动切换；来源 ' + hostOf(c.url);
    var at = -1;
    for(var q=0;q<rlist.length;q++) if(rlist[q].id === item.id){ at = q; break; }
    if(at >= 0) rlist[at] = item;   // 幂等：同片名+主源覆盖更新
    else { rlist.unshift(item); added++; }
  }
  setStore('kh_vod_res', rlist.slice(0,50));
  /* 3. 直播频道 */
  var chs = Array.isArray(data.channels) ? data.channels : [];
  var clist = getLive();
  for(var n=0;n<chs.length && clist.length < 50;n++){
    var ch = chs[n];
    if(!ch || typeof ch.name !== 'string' || !ch.name.trim()) continue;
    var cu = normalizeStreamUrl(String(ch.url || ''));
    if(!cu) continue;
    var dupc = false;
    for(var w=0;w<clist.length;w++) if(clist[w].url === cu){ dupc = true; break; }
    if(dupc) continue;
    clist.unshift({name:String(ch.name).trim().slice(0,20), url:cu,
      group:(typeof ch.group === 'string' && ch.group.trim()) ? ch.group.trim().slice(0,12) : '远程同步'});
    added++;
  }
  setStore('kh_live', clist.slice(0,50));
  c.last = Date.now(); c.lastOk = c.last; c.added = (c.added || 0) + added; c.err = '';
  saveRemoteCfg(c);
  if(!silent) toast('远程同步完成：本次新增 ' + added + ' 条（网站 / 资源 / 频道）');
  render();
}
/* 自动同步心跳：每分钟检查一次，距上次同步 ≥10 分钟且开关开启时静默拉取 */
setInterval(function(){
  var c = getRemoteCfg();
  if(!c.auto || !c.url) return;
  if(Date.now() - (c.last || 0) < 600000) return;
  remoteFetchAndApply(c.url, true);
}, 60000);

/* ---------------- 影视仓 · 多仓管理 ---------------- */
/* 说明：影视仓 = 你自己提供的一份 JSON 配置地址，里面列出一批影视站点。
   支持三种写法：本应用简化格式 sites[{name,url}]；TVBox / CatVod 标准格式
   sites[{key,name,api,type,ext}]（从 api 的域名推出可打开的站点地址）；
   以及整段内容被 base64 编码过的仓（不少仓地址返回的是编码串）。
   纪律：应用不内置任何仓地址、不代抓第三方内容，仓内容由用户自行提供与负责。
   每个仓的站点单独存（不写进 kh_sites），删除仓可连站点一起清干净，不污染自建站点。 */
var WH_KEY = 'kh_wh';              // {list:[{id,name,url,enabled,last,lastOk,n,err,kind,subs,lives}]}
var WH_SITES_KEY = 'kh_wh_sites';  // {whId: [{name,url,cat,wh,whName,api,type,ext,header}]}
var WH_LIVES_KEY = 'kh_wh_lives';  // {whId: [{name,url,group}]}  仓自带的直播源
var WH_PARSES_KEY = 'kh_wh_parses';// {whId: [{name,type,url,ext}]} 仓自带的解析接口
/* 1.7.85 容量提升：仓 12→30、同时启用 6→12、单仓站点 300→1000。
   搜索仍只扫启用仓；单仓展示仍分页，避免一次渲染上千行卡顿。 */
var WH_MAX = 30;                   // 最多存 30 个仓（其中同时启用最多 WH_MAX_ON 个）
var WH_MAX_ON = 12;                // 同时启用的仓上限：启用的仓才参与搜索与刷新
var WH_MAX_SITES = 1000;           // 单仓最多落 1000 条站点
var WH_SHOW_SITES = 40;            // 面板里每仓先显示 40 条，其余可展开

function whCleanOne(w, i) {
  if (!w || typeof w !== 'object') return null;
  var url = String(w.url || '').trim();
  return {
    id: String(w.id || ('wh' + i + '_' + Date.now().toString(36))),
    name: String(w.name || ('影视仓' + (i + 1))).trim().slice(0, 12),
    url: /^https?:\/\//i.test(url) ? url.slice(0, 400) : '',
    enabled: w.enabled !== false,
    last: Number(w.last || 0), lastOk: Number(w.lastOk || 0),
    n: Number(w.n || 0),
    kind: String(w.kind || '').slice(0, 12),
    subs: Number(w.subs || 0),
    lives: Number(w.lives || 0),
    err: typeof w.err === 'string' ? w.err.slice(0, 80) : ''
  };
}
function getWhList() {
  if(window.KH_STORE) return [];   /* 商店变体：无影视仓 */
  var v = getStore(WH_KEY, null);
  var list = (v && Array.isArray(v.list)) ? v.list : [];
  var out = [];
  for (var i = 0; i < list.length; i++) { var c = whCleanOne(list[i], i); if (c) out.push(c); }
  /* 旧版「远程配置」只有单源，首次进入自动迁成第一个仓，用户已填的地址不丢 */
  if (!out.length && typeof getRemoteCfg === 'function') {
    var rc = getRemoteCfg();
    if (rc && rc.url) {
      out = [whCleanOne({ id: 'wh_migrated', name: '我的配置', url: rc.url, enabled: true,
        last: rc.last, lastOk: rc.lastOk, n: rc.added, err: rc.err }, 0)];
      saveWhList(out);
    }
  }
  return out;
}
function saveWhList(list) { setStore(WH_KEY, { list: (list || []).slice(0, WH_MAX) }); }
function getWh(id) {
  var list = getWhList();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function whSitesMap() {
  var v = getStore(WH_SITES_KEY, null);
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}
function saveWhSitesMap(m) { setStore(WH_SITES_KEY, m || {}); }
function whSiteCount(id) {
  var m = whSitesMap(), arr = m[id];
  return Array.isArray(arr) ? arr.length : 0;
}
function whTotalSites() {
  var list = getWhList(), m = whSitesMap(), n = 0;
  for (var i = 0; i < list.length; i++) if (list[i].enabled) {
    var a = m[list[i].id];
    n += Array.isArray(a) ? a.length : 0;
  }
  return n;
}
/* 启用仓的站点摊平（供站点视图展示与搜索命中）；带上接口信息与站点自带头/扩展，
   否则跨仓搜片能搜到、点进去却拉不出线路。 */
function whAllSites() {
  var list = getWhList(), m = whSitesMap(), out = [];
  for (var i = 0; i < list.length; i++) {
    var w = list[i];
    if (!w.enabled) continue;
    var a = m[w.id];
    if (!Array.isArray(a)) continue;
    for (var j = 0; j < a.length; j++) {
      var s = a[j];
      if (!s || !s.url) continue;
      out.push({ name: s.name, url: s.url, cat: s.cat || '影视仓', tag: s.tag || String(s.name || '?').slice(0, 1),
        color: s.color || '#3B456B', wh: w.id, whName: w.name, from: 'wh',
        api: s.api || '', type: Number(s.type || 0) || 0, ext: s.ext || '', header: s.header || '' });
    }
  }
  return out;
}
/* 站点地址推断：优先 url / website，其次从 api 的 origin 推（TVBox 仓只有 api 字段） */
function whSiteUrlOf(s) {
  if (!s || typeof s !== 'object') return '';
  var cands = [s.url, s.website, s.site, s.home, s.api];
  for (var i = 0; i < cands.length; i++) {
    var v = cands[i];
    if (typeof v !== 'string') continue;
    v = v.trim();
    if (!v) continue;
    if (/^https?:\/\//i.test(v)) {
      try {
        var u = new URL(v);
        return u.origin && u.origin !== 'null' ? u.origin : '';
      } catch (e) { /* 非法 URL 跳过 */ }
    }
  }
  return '';
}
/* 解析一份仓数据 → 站点列表（幂等去重，按 url 判重）
   1.7.81：保留 ext（接口扩展参数）/ header（站点自带请求头）/ 分组 / jar 标记。
   没有 ext 与 header 时大量 TVBox 站点会「在列表里但取不到片」。 */
function normalizeWarehouse(data, wh) {
  var raw = [];
  if (data && Array.isArray(data.sites)) raw = data.sites;
  else if (data && Array.isArray(data.list)) raw = data.list;
  else if (data && Array.isArray(data.data)) raw = data.data;
  var out = [], seen = {};
  for (var i = 0; i < raw.length && out.length < WH_MAX_SITES; i++) {
    var s = raw[i];
    if (!s || typeof s !== 'object') continue;
    var name = String(s.name || s.title || s.key || '').trim();
    if (!name) continue;
    var u = whSiteUrlOf(s);
    if (!u || seen[u]) continue;
    seen[u] = 1;
    var ext = '';
    if (s.ext != null) {
      ext = (typeof s.ext === 'string') ? s.ext.trim() : (function () { try { return JSON.stringify(s.ext); } catch (e) { return ''; } })();
      ext = String(ext || '').slice(0, 2000);
    }
    var hd = '';
    if (s.header && typeof s.header === 'object') { try { hd = JSON.stringify(s.header); } catch (e) { hd = ''; } }
    else if (typeof s.header === 'string') hd = s.header.trim();
    hd = String(hd || '').slice(0, 600);
    var grp = String(s['class'] || s.group || s.cat || s.category || '').trim().slice(0, 8);
    out.push({
      name: name.slice(0, 20),
      url: u.slice(0, 300),
      tag: name.slice(0, 1),
      color: '#3B456B',
      cat: grp || '影视仓',
      /* 保留接口地址与类型：type≥1 的站点交给解析器取片单，不再只当网站入口 */
      api: (typeof s.api === 'string' && /^https?:\/\//i.test(s.api.trim())) ? s.api.trim().slice(0, 400) : '',
      type: Number(s.type || 0) || 0,
      ext: ext,
      header: hd,
      /* jar：该站依赖 Java 爬虫包，桌面端没有运行环境，能识别但播不了，界面上要如实标出来 */
      jar: (typeof s.jar === 'string' && s.jar.trim()) ? 1 : 0,
      wh: wh.id, whName: wh.name
    });
  }
  return out;
}
/* 仓形态判定：多仓索引 / 普通站点仓 / 依赖 jar 的爬虫仓 */
function warehouseKind(data) {
  if (!data || typeof data !== 'object') return 'unknown';
  if (Array.isArray(data.urls) && data.urls.length) return 'multi';
  if (Array.isArray(data.sites) || Array.isArray(data.list) || Array.isArray(data.data)) {
    var arr = data.sites || data.list || data.data;
    var jar = 0, api = 0;
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i];
      if (!s || typeof s !== 'object') continue;
      if (typeof s.jar === 'string' && s.jar.trim()) jar++;
      if (typeof s.api === 'string' && s.api.trim()) api++;
    }
    if (jar && jar === arr.length) return 'jar';
    return 'sites';
  }
  if (Array.isArray(data.lives)) return 'lives';
  return 'unknown';
}
/* 多仓索引展开：urls:[{name,url}] → 子仓清单（最多 12 个，且每个子仓独立去重） */
function warehouseSubs(data) {
  var out = [];
  var raw = (data && Array.isArray(data.urls)) ? data.urls : [];
  for (var i = 0; i < raw.length && out.length < 12; i++) {
    var u = raw[i];
    var url = (typeof u === 'string') ? u : String((u && (u.url || u.api)) || '');
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ name: String((u && (u.name || u.title)) || ('子仓' + (i + 1))).trim().slice(0, 12), url: url.trim().slice(0, 400) });
  }
  return out;
}
/* 仓自带直播源：TVBox 的 lives:[{name,url}]，url 常是 "频道名,#genre#\n名,地址" 的 txt */
function normalizeLives(data, wh) {
  var out = [], raw = (data && Array.isArray(data.lives)) ? data.lives : [];
  for (var i = 0; i < raw.length && out.length < 20; i++) {
    var l = raw[i];
    if (!l || typeof l !== 'object') continue;
    var url = String(l.url || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ name: String(l.name || ('直播源' + (i + 1))).trim().slice(0, 20), url: url.slice(0, 400), group: String(l.group || '').slice(0, 12), wh: wh.id, whName: wh.name });
  }
  return out;
}
/* 仓自带解析接口：TVBox 的 parses:[{name,type,url}]，type=1 需要加前缀拼接播放地址 */
function normalizeParses(data, wh) {
  var out = [], raw = (data && Array.isArray(data.parses)) ? data.parses : [];
  for (var i = 0; i < raw.length && out.length < 20; i++) {
    var p = raw[i];
    if (!p || typeof p !== 'object') continue;
    var url = String(p.url || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ name: String(p.name || ('解析' + (i + 1))).trim().slice(0, 20), type: Number(p.type || 0) || 0, url: url.slice(0, 400), ext: String(p.ext || '').slice(0, 200), wh: wh.id, whName: wh.name });
  }
  return out;
}
/* 1.7.85 解析兼容：字节 → 文本，UTF-8 严格失败退 GB18030（国内大量仓配置是 GBK），
   再退宽松 UTF-8。桌面端由主进程桥拿到二进制后走这里，网页端 fetch 的 arrayBuffer 也走这里。 */
function khDecodeWarehouse(buf) {
  try {
    if (!buf) return '';
    var u8 = (buf instanceof ArrayBuffer) ? new Uint8Array(buf)
      : (ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : null);
    if (!u8) return String(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { /* 不是合法 UTF-8 */ }
    try { return new TextDecoder('gb18030', { fatal: false }).decode(u8); } catch (e2) { /* 环境不支持 GB18030 */ }
    return new TextDecoder('utf-8').decode(u8);
  } catch (e3) { return ''; }
}
/* 1.7.85 字节流拉取仓配置：优先主进程桥（无跨域 + 拿二进制智能解码），
   失败退回渲染层 fetch + arrayBuffer。返回 Promise<string>。 */
function khFetchWarehouseText(url, signal) {
  /* 桌面端：主进程桥要二进制，按 GB18030/UTF-8 智能解码 */
  if (typeof window !== 'undefined' && window.khHttp && typeof window.khHttp.get === 'function') {
    return window.khHttp.get({ url: url, timeout: 20000, binary: true })
      .then(function (r) {
        if (!r || !r.ok) throw new Error((r && (r.reason || ('HTTP ' + r.status))) || '请求失败');
        if (r.base64 != null) {
          try { return khDecodeWarehouse(Uint8Array.from(atob(r.base64), function (c) { return c.charCodeAt(0); })); }
          catch (e) { /* base64 异常退回 text */ }
        }
        return String(r.text || '');
      });
  }
  /* 网页 / HAP：直连 fetch，用 arrayBuffer 智能解码 */
  if (typeof fetch !== 'function') return Promise.reject(new Error('当前环境不支持网络请求'));
  return fetch(url, { cache: 'no-store', signal: signal || undefined })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(function (buf) { return khDecodeWarehouse(buf); });
}
/* 清洗仓文本：去 BOM / 去控制字符 / 去行首 // 注释 / 去围栏标记 / 截取 JSON 主体。
   1.7.85：不少仓配置带「//说明」抬头或前后杂文本，过去 JSON.parse 直接失败。 */
function khCleanWarehouseText(txt) {
  var t = String(txt == null ? '' : txt);
  t = t.replace(/^\uFEFF/, '');                       // BOM
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // 控制字符
  /* 去掉每行行首的 // 注释，保留行内 http:// 中的 // */
  t = t.split(/\r?\n/).filter(function (line) { return !/^\s*\/\//.test(line); }).join('\n');
  t = t.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, ''); // Markdown 代码围栏
  t = t.trim();
  /* 前后有杂文本时，截取第一个 { 或 [ 到最后一个 } 或 ] 的 JSON 主体 */
  var first = -1;
  for (var i = 0; i < t.length; i++) { if (t.charAt(i) === '{' || t.charAt(i) === '[') { first = i; break; } }
  if (first > 0) {
    var last = -1;
    for (var j = t.length - 1; j >= first; j--) { if (t.charAt(j) === '}' || t.charAt(j) === ']') { last = j; break; } }
    if (last > first) t = t.slice(first, last + 1);
  }
  return t.trim();
}
/* 文本 → 仓数据：先按 JSON 解，失败再试 base64（不少仓地址返回编码串） */
function parseWarehouseText(txt) {
  var t = khCleanWarehouseText(txt);
  if (!t) throw new Error('内容为空');
  try { return JSON.parse(t); } catch (e) { /* 继续试 base64 */ }
  var cleaned = t.replace(/\s+/g, '');
  try {
    var dec = atob(cleaned);
    try { return JSON.parse(dec); } catch (e2) { return JSON.parse(decodeURIComponent(escape(dec))); }
  } catch (e3) { /* 落到统一报错 */ }
  throw new Error('既不是合法 JSON，也不是 base64 编码的配置');
}
/* 拉一个子仓（多仓索引里的地址），失败如实记账不影响其它子仓 */
function whFetchOneSub(sub) {
  var ctl = ('AbortController' in window) ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
  return khFetchWarehouseText(sub.url, ctl ? ctl.signal : undefined)
    .then(function (t) { clearTimeout(timer);
      var d = parseWarehouseText(t);
      if (warehouseKind(d) === 'jar') throw new Error('子仓依赖 jar 爬虫，已跳过');
      var st = normalizeWarehouse(d, { id: 'sub', name: sub.name });
      if (!st.length) throw new Error('子仓里没有可用站点');
      return { name: sub.name, sites: st, lives: normalizeLives(d, { id: 'sub', name: sub.name }) };
    }, function (e) { clearTimeout(timer); throw e; });
}
/* 多仓展开：最多 3 路并发，避免把对方站点打炸 */
function whFetchSubs(subs) {
  var groups = [], errs = [], cursor = 0;
  function next() {
    if (cursor >= subs.length) return Promise.resolve();
    var sub = subs[cursor++];
    return whFetchOneSub(sub).then(function (g) { groups.push(g); }, function (e) {
      errs.push({ name: sub.name, reason: String((e && e.message) || e).slice(0, 50) });
    }).then(next);
  }
  var w = [];
  for (var i = 0; i < Math.min(3, subs.length); i++) w.push(next());
  return Promise.all(w).then(function () { return { groups: groups, errs: errs }; });
}

/* 拉取并落地：支持普通站点仓 / 多仓索引 / 自带直播源与解析接口；
   成功记 lastOk 与条数，失败记 err（不覆盖已有站点） */
function whFetchApply(wh, silent) {
  if (!wh || !wh.url) { if (!silent) toast('这个仓还没填地址'); return; }
  var list = getWhList();
  var target = null;
  for (var i = 0; i < list.length; i++) if (list[i].id === wh.id) target = list[i];
  if (!target) return;
  var ctl = ('AbortController' in window) ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
  if (!silent) toast('正在拉取「' + target.name + '」…');
  khFetchWarehouseText(target.url, ctl ? ctl.signal : undefined)
    .then(function (txt) { clearTimeout(timer);
      var data = parseWarehouseText(txt);
      var kind = warehouseKind(data);
      /* jar 仓：能认出来就要说清楚，不能导成 0 站点让用户以为地址错了 */
      if (kind === 'jar') throw new Error('该仓依赖 jar 爬虫包（spider），本程序无法运行，请换普通接口仓');
      var sites = normalizeWarehouse(data, target);
      var lives = normalizeLives(data, target);
      var parses = normalizeParses(data, target);
      var subs = (kind === 'multi') ? warehouseSubs(data) : [];
      if (!sites.length && !lives.length && !subs.length) {
        throw new Error('仓里没有解析到可用站点（需含 sites[]，且每条有 name 与 api/url）');
      }
      var expand = subs.length ? whFetchSubs(subs) : Promise.resolve({ groups: [], errs: [] });
      return expand.then(function (ex) {
        if (ex.groups.length) {
          var seen = {}, merged = [];
          for (var g = 0; g < ex.groups.length; g++) {
            var arr = ex.groups[g].sites;
            for (var k = 0; k < arr.length; k++) {
              var it = arr[k];
              if (!it || !it.url || seen[it.url]) continue;
              seen[it.url] = 1;
              merged.push(it);
            }
            if (ex.groups[g].lives && ex.groups[g].lives.length) lives = lives.concat(ex.groups[g].lives);
          }
          sites = sites.concat(merged).slice(0, WH_MAX_SITES);
        }
        var m = whSitesMap();
        m[target.id] = sites;
        saveWhSitesMap(m);
        var lm = getStore(WH_LIVES_KEY, null);
        if (!lm || typeof lm !== 'object' || Array.isArray(lm)) lm = {};
        lm[target.id] = lives.slice(0, 60);
        setStore(WH_LIVES_KEY, lm);
        var pm = getStore(WH_PARSES_KEY, null);
        if (!pm || typeof pm !== 'object' || Array.isArray(pm)) pm = {};
        pm[target.id] = parses.slice(0, 20);
        setStore(WH_PARSES_KEY, pm);
        target.last = Date.now(); target.lastOk = target.last; target.n = sites.length; target.err = '';
        target.kind = kind; target.subs = subs.length; target.lives = lives.length;
        saveWhList(replaceWhIn(getWhList(), target));
        if (!silent) {
          var msg = '「' + target.name + '」已更新：' + sites.length + ' 个站点';
          if (subs.length) msg += ' · 展开 ' + ex.groups.length + '/' + subs.length + ' 个子仓';
          if (lives.length) msg += ' · ' + lives.length + ' 个直播源';
          if (parses.length) msg += ' · ' + parses.length + ' 条解析';
          if (ex.errs.length) msg += '（' + ex.errs.length + ' 个子仓失败）';
          toast(msg);
        }
        if (typeof state !== 'undefined' && state && state.view === 'sites') render();
      });
    })
    .catch(function (e) {
      clearTimeout(timer);
      target.last = Date.now();
      target.err = (e && e.message ? e.message : '网络不可达').slice(0, 80);
      saveWhList(replaceWhIn(getWhList(), target));
      if (!silent) toast('「' + target.name + '」拉取失败：' + target.err);
      if (typeof state !== 'undefined' && state && state.view === 'sites') render();
    });
}
function replaceWhIn(list, wh) {
  for (var i = 0; i < list.length; i++) if (list[i].id === wh.id) { list[i] = wh; break; }
  return list;
}
function whEnabledCount() {
  var list = getWhList(), n = 0;
  for (var i = 0; i < list.length; i++) if (list[i].enabled) n++;
  return n;
}
function whAdd(name, url) {
  var list = getWhList();
  if (list.length >= WH_MAX) { toast('最多存 ' + WH_MAX + ' 个影视仓，先删掉一个再添加'); return false; }
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) { toast('仓地址需以 http(s):// 开头'); return false; }
  for (var i = 0; i < list.length; i++) if (list[i].url === url) { toast('这个仓地址已经加过了'); return false; }
  var wh = whCleanOne({ id: 'wh' + Date.now().toString(36), name: name || ('影视仓' + (list.length + 1)), url: url }, list.length);
  /* 同时启用的仓才参与搜索与刷新，上限 6：超了就存成停用，不让搜索被拖死 */
  if (whEnabledCount() >= WH_MAX_ON) {
    wh.enabled = false;
    toast('已添加「' + wh.name + '」。同时启用上限 ' + WH_MAX_ON + ' 个，这个先存为停用，需要时再打开');
  } else {
    toast('已添加「' + wh.name + '」，正在拉取…');
  }
  list.push(wh);
  saveWhList(list);
  if (wh.enabled) whFetchApply(wh, false);
  return true;
}
function whRemove(id) {
  var list = getWhList(), out = [];
  for (var i = 0; i < list.length; i++) if (list[i].id !== id) out.push(list[i]);
  saveWhList(out);
  var m = whSitesMap();
  delete m[id];
  saveWhSitesMap(m);
}
/* 粘贴导入：内容写进指定仓（无指定则建一个「粘贴导入」仓） */
function whImportText(id, text) {
  var target = id ? getWh(id) : null;
  var created = false;
  if (!target) {
    var list = getWhList();
    if (list.length >= WH_MAX) { toast('最多存 ' + WH_MAX + ' 个影视仓，先删掉一个'); return; }
    target = whCleanOne({ id: 'wh' + Date.now().toString(36), name: '粘贴导入', url: '' }, list.length);
    target.enabled = whEnabledCount() < WH_MAX_ON;
    list.push(target);
    saveWhList(list);
    created = true;
  }
  var data;
  try { data = parseWarehouseText(text); }
  catch (e) { toast('导入失败：' + (e && e.message ? e.message : '格式错误')); if (created) whRemove(target.id); return; }
  var kind = warehouseKind(data);
  if (kind === 'jar') { toast('导入失败：该仓依赖 jar 爬虫包（spider），本程序无法运行'); if (created) whRemove(target.id); return; }
  if (kind === 'multi') {
    toast('这是个多仓索引，请直接填仓地址让它自动展开（粘贴只能存单仓站点）');
    if (created) whRemove(target.id);
    return;
  }
  var sites = normalizeWarehouse(data, target);
  var lives = normalizeLives(data, target);
  if (!sites.length && !lives.length) { toast('导入失败：没有解析到可用站点'); if (created) whRemove(target.id); return; }
  var m = whSitesMap();
  m[target.id] = sites;
  saveWhSitesMap(m);
  var lm = getStore(WH_LIVES_KEY, null);
  if (!lm || typeof lm !== 'object' || Array.isArray(lm)) lm = {};
  lm[target.id] = lives.slice(0, 60);
  setStore(WH_LIVES_KEY, lm);
  var pm = getStore(WH_PARSES_KEY, null);
  if (!pm || typeof pm !== 'object' || Array.isArray(pm)) pm = {};
  pm[target.id] = normalizeParses(data, target).slice(0, 20);
  setStore(WH_PARSES_KEY, pm);
  target.n = sites.length; target.lives = lives.length; target.kind = kind;
  target.lastOk = Date.now(); target.last = target.lastOk; target.err = '';
  saveWhList(replaceWhIn(getWhList(), target));
  toast('已导入「' + target.name + '」：' + sites.length + ' 个站点' + (lives.length ? ' · ' + lives.length + ' 个直播源' : ''));
}
/* 仓地址健康检查：只探不存，告诉用户这个地址值不值得留 */
function whProbe(url, done) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) { done({ ok: false, reason: '地址不是 http(s)' }); return; }
  var t0 = Date.now();
  var ctl = ('AbortController' in window) ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
  khFetchWarehouseText(url, ctl ? ctl.signal : undefined)
    .then(function (txt) { clearTimeout(timer);
      var data = parseWarehouseText(txt);
      var kind = warehouseKind(data);
      var subs = (kind === 'multi') ? warehouseSubs(data) : [];
      var sites = normalizeWarehouse(data, { id: 'probe', name: 'probe' });
      var api = 0;
      for (var i = 0; i < sites.length; i++) if (sites[i].api) api++;
      var lives = normalizeLives(data, { id: 'probe', name: 'probe' });
      done({
        ok: true, kind: kind, sites: sites.length, api: api, subs: subs.length,
        lives: lives.length, parses: normalizeParses(data, { id: 'probe', name: 'probe' }).length,
        ms: Date.now() - t0, size: String(txt || '').length
      });
    })
    .catch(function (e) {
      clearTimeout(timer);
      done({ ok: false, reason: String((e && e.message) || e || '网络不可达').slice(0, 60), ms: Date.now() - t0 });
    });
}
/* 定时刷新：默认 30 分钟一次，遍历启用且有地址的仓，静默执行 */
function whAutoTick() {
  var list = getWhList();
  for (var i = 0; i < list.length; i++) {
    var w = list[i];
    if (!w.enabled || !w.url) continue;
    if (Date.now() - (w.last || 0) < 1800000) continue;
    whFetchApply(w, true);
  }
}
setInterval(function () { try { whAutoTick(); } catch (e) { } }, 60000);

/* ---------------- 内置种子：客户首次打开自动导入网站 + 影视仓 ----------------
   纪律说明：这是对「用户提供、自行负责」配置的一次性本机导入，不是应用代抓第三方内容。
   写入本机 localStorage（kh_sites / kh_wh / kh_wh_sites），只做一次（版本标记 kh_seed_v）；
   用户随后删除不会被重新灌回。内置仓 url 留空 → whAutoTick 按 !url 跳过，不会被远程覆盖。 */
var SEED_VER_KEY = 'kh_seed_v';
var SEED_VER = 3;   /* 提升到 3：追加 6 个影视网站 + 22 条采集接口 */
var SEED_WH_ID = 'wh_builtin_seed';
var SEED_WH_NAME = '内置资源仓';
/* 内置网站（来自用户提供清单；zhaoju4 已在 BUILTIN_SITES，按 url 去重自动跳过） */
var SEED_SITES = [
  {name:'电影天堂',   url:'https://www.afhgrj.com/y/2/', color:'#3B456B', tag:'电', cat:'影视'},
  {name:'金牌影院',   url:'https://sizhengxt.com/',      color:'#3B456B', tag:'金', cat:'影视'},
  {name:'电影天堂2',  url:'https://www.tfznaz.com/',     color:'#3B456B', tag:'电', cat:'影视'},
  {name:'找剧AI',     url:'https://zhaoju4.com/',        color:'#7C5CFF', tag:'找', cat:'影视'},
  {name:'电影天堂3',  url:'https://www.jianwuye5.com/',  color:'#3B456B', tag:'电', cat:'影视'},
  {name:'茶杯狐',     url:'https://m.irrmj.cc/',         color:'#3B456B', tag:'茶', cat:'影视'}
];
/* 内置影视仓接口（用户提供，曾实测可用；type=1 走解析器取片单） */
var SEED_WH_APIS = [
  ['光速资源','https://api.guangsuapi.com/api.php/provide/vod/from/gsm3u8'],
  ['虎牙采集','https://www.huyaapi.com/api.php/provide/vod/from/hym3u8'],
  ['淘片采集','https://taopianapi.com/cjapi/mc/vod/json.html'],
  ['火狐采集','https://hhzyapi.com/api.php/provide/vod/'],
  ['量子资源','https://lzizy1.com/api.php/provide/vod/'],
  ['百度采集','https://api.apibdzy.com/api.php/provide/vod/?ac=list'],
  ['影视天涯','http://tyyszy.com/api.php/provide/vod'],
  ['影视非凡','http://ffzy.tv/api.php/provide/vod/'],
  ['影视极速','https://jszyapi.com/api.php/provide/vod/?ac=list'],
  ['影视建安','http://154.219.117.232:9981/jacloudapi.php/provide/vod'],
  ['光速资源(切)','https://api.guangsuapi.com/api.php/provide/vod/'],
  ['创享影视','https://ys.cxkjg.cn/api/provide/vod'],
  ['金鹰','https://ys.cxkjg.cn/api/provide/vod?source=2680151544'],
  ['闪电','https://ys.cxkjg.cn/api/provide/vod?source=3848762792'],
  ['非凡','https://ys.cxkjg.cn/api/provide/vod?source=1840804598'],
  ['速博','https://ys.cxkjg.cn/api/provide/vod?source=1016684692'],
  ['HD(SN)','https://ys.cxkjg.cn/api/provide/vod?source=1208629981'],
  ['U酷','https://ys.cxkjg.cn/api/provide/vod?source=4194624554'],
  ['WS','https://ys.cxkjg.cn/api/provide/vod?source=4118858385'],
  ['樱花','https://ys.cxkjg.cn/api/provide/vod?source=531717376'],
  ['红牛','https://ys.cxkjg.cn/api/provide/vod?source=2761253814'],
  ['光速','https://ys.cxkjg.cn/api/provide/vod?source=4247318859']
];
function khSeedBuiltin(){
  if(window.KH_STORE) return;   /* 商店变体：不灌任何内置网站/影视仓种子 */
  try{
    if(Number(getStore(SEED_VER_KEY, 0)) >= SEED_VER) return;
    /* 1) 网站：并入自建站点，按 url 去重，跳过预置里已有的（如找剧AI） */
    var sites = getSites(), known = {};
    for(var b=0;b<BUILTIN_SITES.length;b++) known[BUILTIN_SITES[b].url] = 1;
    for(var i=0;i<sites.length;i++) known[sites[i].url] = 1;
    var add = 0;
    for(var j=0;j<SEED_SITES.length && sites.length<50;j++){
      var s = SEED_SITES[j];
      if(known[s.url]) continue;
      known[s.url] = 1;
      sites.push({name:s.name, url:s.url, color:s.color, tag:s.tag, cat:s.cat});
      add++;
    }
    setStore('kh_sites', sites);
    /* 2) 影视仓接口：整成一个内置仓，站点结构与 normalizeWarehouse 一致 */
    var list = getWhList(), has = false;
    for(var k=0;k<list.length;k++) if(list[k].id === SEED_WH_ID){ has = true; break; }
    if(!has){
      var wh = { id:SEED_WH_ID, name:SEED_WH_NAME, url:'', enabled:true, kind:'builtin',
                 last:Date.now(), lastOk:Date.now(), n:0, subs:0, lives:0, err:'' };
      var rows = [], seen = {};
      for(var m=0;m<SEED_WH_APIS.length;m++){
        var a = SEED_WH_APIS[m], api = String(a[1]||'').trim(), uu = '';
        try{ var u = new URL(api); uu = u.origin; }catch(e){}
        if(!uu) continue;
        /* 按完整 api 去重：创享多 source 是同域名不同片库源，必须全部保留 */
        var dk = api.replace(/\/+$/, '');
        if(seen[dk]) continue;
        seen[dk] = 1;
        rows.push({ name:String(a[0]).slice(0,20), url:uu, tag:String(a[0]).slice(0,1),
          color:'#3B456B', cat:'采集', api:api, type:1, ext:'', header:'', jar:0,
          wh:SEED_WH_ID, whName:SEED_WH_NAME });
      }
      wh.n = rows.length;
      list.push(wh);
      saveWhList(list);
      var map = whSitesMap(); map[SEED_WH_ID] = rows; saveWhSitesMap(map);
    }
    setStore(SEED_VER_KEY, SEED_VER);
  }catch(e){ /* 种子失败不影响启动，用户仍可手动导入 */ }
}

/* ---------------- 场景预设 · 一键切换 ---------------- */
/* 场景 = 一批配置键的推荐取值。切换时只写该档明确列出的键，其余键保持原值，
   避免「点一下省电把用户辛苦调的字号也改了」。用户手改后不埋点，
   靠运行时把当前值与档位期望值比对，得出「已微调 N 项」。 */
var SCENE_KEY = 'kh_scene';
var SCENES = [
  { id: 'eco',  name: '省电',  icon: '🔋', hint: '低配机 · 少占资源',
    keys: { kh_motion: 0, kh_font_scale: 100, kh_senior: false, kh_night: false, kh_sleep_min: 30, kh_loudness_eq: false } },
  { id: 'film', name: '长片',  icon: '🎬', hint: '电影长剧 · 连贯不熄屏',
    keys: { kh_motion: 1, kh_font_scale: 100, kh_senior: false, kh_night: false, kh_sleep_min: 0, kh_loudness_eq: true } },
  { id: 'live', name: '直播',  icon: '📺', hint: '球赛新闻 · 追台更激进',
    keys: { kh_motion: 1, kh_font_scale: 100, kh_senior: false, kh_night: true, kh_sleep_min: 60, kh_loudness_eq: false } },
  { id: 'elder',name: '长辈',  icon: '👴', hint: '大字号 · 大按钮',
    keys: { kh_motion: 0, kh_font_scale: 150, kh_senior: true, kh_night: false, kh_sleep_min: 30, kh_loudness_eq: false } }
];
function sceneById(id){
  for (var i = 0; i < SCENES.length; i++) if (SCENES[i].id === id) return SCENES[i];
  return null;
}
function getScene(){
  var v = getStore(SCENE_KEY, null);
  if (!v || typeof v !== 'object') return { id: '', at: 0 };
  var s = sceneById(v.id);
  return { id: s ? s.id : '', at: Number(v.at || 0) };
}
function saveScene(id){ setStore(SCENE_KEY, { id: id || '', at: id ? Date.now() : 0 }); }
/* 当前值与档位期望值不一致的键，即「已微调」 */
function sceneTuned(id){
  var s = sceneById(id), out = [];
  if (!s) return out;
  for (var k in s.keys) {
    if (!Object.prototype.hasOwnProperty.call(s.keys, k)) continue;
    var want = s.keys[k];
    var cur = getStore(k, null);
    var same = (typeof want === 'boolean') ? (!!cur === want) : (Number(cur) === Number(want));
    if (cur === null || cur === undefined || !same) out.push(k);
  }
  return out;
}
function applyScene(id){
  var s = sceneById(id);
  if (!s) return false;
  /* 儿童模式优先：开着儿童锁时只允许省电/长辈两档 */
  var kid = getStore('kh_kid', null);
  if (kid && kid.on && id !== 'eco' && id !== 'elder') {
    toast('儿童模式开着，只能切到「省电」或「长辈」档');
    return false;
  }
  for (var k in s.keys) {
    if (!Object.prototype.hasOwnProperty.call(s.keys, k)) continue;
    setStore(k, s.keys[k]);
  }
  setStore('kh_font_scale', s.keys.kh_font_scale);   // 字号立即生效依赖 render，下面统一刷
  saveScene(id);
  if (typeof applyMotionPref === 'function') applyMotionPref();
  if (typeof applyFontScale === 'function') applyFontScale();
  toast('已切到「' + s.name + '」档');
  return true;
}
/* 字号档（100–150%）统一消费方：切场景/改设置后立即套到 body，无需重开 */
function applyFontScale(v){
  var fs = Number(v === undefined || v === null ? getStore('kh_font_scale', 100) : v) || 100;
  if (fs < 80) fs = 80;
  if (fs > 200) fs = 200;
  try { document.body.style.zoom = fs === 100 ? '' : String(fs / 100); } catch (e) { }
  try { document.documentElement.setAttribute('data-font-scale', String(fs)); } catch (e) { }
  return fs;
}
/* 动效总开关的消费方：给 body 加 class，CSS 里关掉过渡与动画 */
function applyMotionPref(){
  try {
    var off = !Number(getStore('kh_motion', 1));
    document.body.classList.toggle('no-motion', off);
  } catch (e) { }
}

var CATEGORIES = ['全部','电影','动画','短剧','剧集','纪录片','综艺'];
/* 1.7.102：默认不再有预置推荐分组（原两段指向已移除的样片 id）。
   分组只来自「推荐位」的云端/本机配置，且 id 必须命中自有片源才渲染。 */
var SECTIONS = [];

/* 1.7.103 播放诊断探针用的三条公开测试流。
   只在「问题中心 → 播放诊断」里手动跑，不参与片单 / 推荐 / 搜索 / 计数，也不算内置片源。
   三条分别覆盖：H.264+mp4（最常见）、HLS 分片、VP9+webm（用来区分「是不是只缺 H.264 解码器」）。 */
var DIAG_STREAMS = [
  {id:"mp4_h264", label:"H.264 / mp4（约 1 MB 短样）", url:"https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4", note:"最常见编码，桌面端与多数设备应可解"},
  {id:"hls_h264", label:"HLS / m3u8（分片）", url:"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", note:"测分片链路与网络，需要浏览器支持 MSE"},
  {id:"webm_vp9", label:"VP9 / webm（约 1 MB）", url:"https://test-videos.co.uk/vids/bigbuckbunny/webm/vp9/360/Big_Buck_Bunny_360_10s_1MB.webm", note:"这条能播而 H.264 不能，说明缺的是 H.264 解码器"}
];
/* 首页分组：内置片单为基线；云端推荐位启用时覆盖首段标题与条目。
   云端条目 id 必须能在本机片单中命中才渲染，未命中的云端条目不展示（不凭空造片）。 */
function getSections(){
  var base = SECTIONS.slice();
  var promo = null;
  try { promo = getStore('kh_promo', null); } catch(e) { promo = null; }
  if(!promo || !promo.enabled || !Array.isArray(promo.items) || !promo.items.length) return base;
  var known = {}; allMovies().forEach(function(m){ known[m.id] = true; });
  var ids = promo.items.map(function(it){ return it && it.id; }).filter(function(id){ return id && known[id]; });
  if(!ids.length) return base;
  var head = {title: promo.title || '今日推荐', sub: promo.subtitle || '云端推荐位', ids: ids};
  return [head].concat(base.slice(1));
}

/* ---------------- 电视直播：频道 / EPG / 自建源 ---------------- */
/* 说明：全部预置频道均直连公开网络直播源（iptv-org 社区收录的免费频道 / 公开测试流），
   点开即从网络主源起播，卡住自动切换备用源，不再默认播放本地画面；
   节目单为目录参考数据。需要接入有授权的指定信号时用「添加直播频道」或 M3U 导入。 */
var EPG_NEWS = ['晨间新闻','午间快报','时事观察','焦点访谈','晚间新闻','夜线追踪','深度报道','一周纵览'];
var EPG_FILM = ['经典影院','佳片有约','黄金剧场','午夜场','动画乐园','周末影院','首映时刻','片场纪实'];
var EPG_DOC  = ['自然密码','寰宇地理','人文地图','科学探秘','赛事直播','赛场瞬间','音乐现场','幕后故事'];
/* 每个频道 3 路网络直播源：主源 → 备源 → 备用源 3，全部为浏览器实测可播的公开直播流 */
var LIVE_STATUS = {"cn001":true,"cn002":true,"cn003":true,"cn004":true,"cn005":true,"cn006":true,"cn008":true,"cn009":true,"cn010":true,"cn011":true,"cn012":true,"cn013":true,"cn014":true,"cn015":true,"cn016":true,"cn017":true,"cn019":true,"cn020":true,"cn021":true,"cn028":true,"cn037":true,"cn040":true,"cn044":true,"cn045":true,"cn046":true,"cn050":true,"cn051":true,"x003":true,"x013":true,"x019":true,"x020":true,"x022":true,"x023":true,"cn064":true,"x006":true,"x007":true,"x008":false,"x010":true,"x012":true,"x029":false,"x030":true,"x004":true,"x031":true,"x015":true,"x021":true,"x025":true,"x027":true,"x011":true,"x032":true,"x017":true,"x001":true,"x033":true,"cn091":false,"cn096":true,"x034":true,"x002":true,"x016":true,"x028":true,"net003":true,"x009":false,"x014":true,"x035":true,"x036":true,"x037":true,"x038":true,"x039":true,"x040":true,"x041":true,"x018":true,"x042":true,"x043":true,"x044":true,"x045":true,"x024":true,"cn101":true,"cn102":true,"cn103":false,"cn104":false,"cn105":true,"cn106":true,"cn107":true,"cn108":false,"cn109":true,"cn110":true,"cn111":false,"cn112":true,"cn113":true,"cn114":true,"cn115":false,"cn116":true,"cn117":true,"cn118":true,"cn119":true,"cn120":true,"cn121":true};
var LIVE_CHANNELS = [
  {id:"cn001",no:1,name:"CCTV-1 综合",group:"央视频道",logo:"综",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0001_1.m3u8?key=txiptv&playlive=1&authid=0"},{label:"备用线路 1",url:"https://liveplay-srs.voc.com.cn/hls/tv/134_180adf.m3u8"}]},
  {id:"cn002",no:2,name:"CCTV-2 财经",group:"央视频道",logo:"财",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0002_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn003",no:3,name:"CCTV-3 综艺",group:"央视频道",logo:"综",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0003_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn004",no:4,name:"CCTV-4 中文国际",group:"央视频道",logo:"中",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0004_1.m3u8?key=txiptv&playlive=1&authid=0"},{label:"备用线路 1",url:"https://dash2.antik.sk/live/test_cctv_tizen/playlist.m3u8"}]},
  {id:"cn005",no:5,name:"CCTV-5 体育",group:"央视频道",logo:"体",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0005_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn006",no:6,name:"CCTV-5+ 体育赛事",group:"央视频道",logo:"体",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0006_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn008",no:7,name:"CCTV-7 国防军事",group:"央视频道",logo:"国",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0007_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn009",no:8,name:"CCTV-8 电视剧",group:"央视频道",logo:"电",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0008_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn010",no:9,name:"CCTV-9 纪录",group:"央视频道",logo:"纪",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0009_1.m3u8?key=txiptv&playlive=1&authid=0"},{label:"备用线路 1",url:"https://xykt-fix.github.io/Y77.m3u8"},{label:"备用线路 2",url:"http://74.91.26.218:82/live/cctv9hd.m3u8"}]},
  {id:"cn011",no:10,name:"CCTV-10 科教",group:"央视频道",logo:"科",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0010_1.m3u8?key=txiptv&playlive=1&authid=0"},{label:"备用线路 1",url:"https://cdn4.skygo.mn/live/disk1/CCTV-10/HLSv3-FTA/CCTV-10.m3u8"}]},
  {id:"cn012",no:11,name:"CCTV-11 戏曲",group:"央视频道",logo:"戏",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0011_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn013",no:12,name:"CCTV-12 社会与法",group:"央视频道",logo:"社",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0012_1.m3u8?key=txiptv&playlive=1&authid=0"},{label:"备用线路 1",url:"http://74.91.26.218:82/live/cctv12hd.m3u8"}]},
  {id:"cn014",no:13,name:"CCTV-13 新闻",group:"央视频道",logo:"新",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0013_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn015",no:14,name:"CCTV-14 少儿",group:"央视频道",logo:"少",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0014_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn016",no:15,name:"CCTV-15 音乐",group:"央视频道",logo:"音",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://124.165.251.82:85/tsfile/live/0015_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn017",no:16,name:"CCTV-16 奥林匹克",group:"央视频道",logo:"奥",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://gmxw.7766.org:808/hls/169/index.m3u8"}]},
  {id:"cn019",no:17,name:"CGTN 英语新闻",group:"央视频道",logo:"英",color:"#C0392B",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://0472.org/hls/cgtn.m3u8"}]},
  {id:"cn020",no:18,name:"湖南卫视",group:"卫视频道",logo:"湖",color:"#1F618D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://hlsal-ldvt.qing.mgtv.com/nn_live/nn_x64/dWlwPTEyNy4wLjAuMSZ1aWQ9cWluZy1jbXMmbm5fdGltZXpvbmU9OCZjZG5leF9pZD1hbF9obHNfbGR2dCZ1dWlkPTliODY4NmU5ZTM2YzYwMmMmZT02OTE0NjA0JnY9MSZpZD1ITldTWkdTVCZzPTcwN2RiYTc2YzJjNmJmMTQ4MmUyZGYzOWU2NWM3YWFi/HNWSZGST.m3u8"},{label:"备用线路 1",url:"https://p8.vzan.com/slowlive/415983998730568937/live.m3u8"},{label:"备用线路 2",url:"http://hlsal-ldvt.qing.mgtv.com/nn_live/nn_x64/dWlwPTEyNy4wLjAuMSZ1aWQ9cWluZy1jbXMmbm5fdGltZXpvbmU9OCZjZG5leF9pZD1hbF9obHNfbGR2dCZ1dWlkPTliODY4NmU5ZTM2YzYwMmMmZT02OTE0NjA0JnY9MSZpZD1ITldTWkdTVCZzPTcwN2RiYTc2YzJjNmJmMTQ4MmUyZGYzOWU2NWM3YWFi/HNWSZGST.m3u8"}]},
  {id:"cn021",no:19,name:"浙江卫视",group:"卫视频道",logo:"浙",color:"#1F618D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://ali-m-l.cztv.com/channels/lantian/channel10/1080p.m3u8"}]},
  {id:"cn028",no:20,name:"安徽卫视",group:"卫视频道",logo:"安",color:"#1F618D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://restream.pdtvhd.com/memfs/c1cd2ed0-3b2b-4c25-af98-a7fb0b1eb130.m3u8"}]},
  {id:"cn037",no:21,name:"河北卫视",group:"卫视频道",logo:"河",color:"#1F618D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://event.pull.hebtv.com/live/live101.m3u8"}]},
  {id:"cn040",no:22,name:"广西卫视",group:"卫视频道",logo:"广",color:"#1F618D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://111.59.24.227:8181/tsfile/live/1001_1.m3u8?authid=0&key=txiptv&playlive=1"}]},
  {id:"cn044",no:23,name:"甘肃卫视",group:"卫视频道",logo:"甘",color:"#1F618D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://218.13.170.98:9901/tsfile/live/0141_1.m3u8"}]},
  {id:"cn045",no:24,name:"内蒙古卫视",group:"卫视频道",logo:"内",color:"#1F618D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://play1-qk.nmtv.cn/live/1769652018126032.m3u8"}]},
  {id:"cn046",no:25,name:"山西卫视",group:"卫视频道",logo:"山",color:"#1F618D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://m3u8.channel.wsrtv.com.cn/cms/videos/nmip-media/channellive/channel7/playlist.m3u8"}]},
  {id:"cn050",no:26,name:"西藏卫视",group:"卫视频道",logo:"西",color:"#1F618D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://live.vtibet.cn/live/ZYWS20261016.stream.m3u8"}]},
  {id:"cn051",no:27,name:"新疆卫视",group:"卫视频道",logo:"新",color:"#1F618D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://110.153.180.106:55555/out_3/index.m3u8"},{label:"备用线路 1",url:"http://110.153.180.106:55555/out_2/index.m3u8"},{label:"备用线路 2",url:"http://120.70.60.179:9901/tsfile/live/1002_1.m3u8?authid=0&key=txiptv&playlive=1"}]},
  {id:"x003",no:28,name:"安多卫视",group:"卫视频道",logo:"安",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://play.kankanlive.com/live/1711956137852982.m3u8"}]},
  {id:"x013",no:29,name:"康巴卫视",group:"卫视频道",logo:"康",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://110.185.237.164:8888/hls/30/index.m3u8"}]},
  {id:"x019",no:30,name:"CGN 中文台",group:"中国港澳台地区",logo:"C",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://d3e05csss9c272.cloudfront.net/out/v1/f0bf71c57581470fb9379f603e8f5d83/CGNWebLiveCN.m3u8"}]},
  {id:"x020",no:31,name:"台湾原民台",group:"中国港澳台地区",logo:"台",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://streamipcfapp.akamaized.net/live/_definst_/live_720/key_b1500.m3u8"}]},
  {id:"x022",no:32,name:"TVBS 亚洲台",group:"中国港澳台地区",logo:"T",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://38.64.72.148/hls/modn/list/4005/playlist.m3u8"}]},
  {id:"x023",no:33,name:"台视新闻",group:"中国港澳台地区",logo:"台",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://live.wcetv.com/hls/master-ttvnews.m3u8"}]},
  {id:"cn064",no:34,name:"五星体育",group:"体育竞技",logo:"五",color:"#239B56",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://rnttwmjcin.turknet.ercdn.net/lcpmvefbyo/aspor/aspor.m3u8"}]},
  {id:"x006",no:35,name:"赤峰综合新闻",group:"新闻资讯",logo:"赤",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://play1-qk.nmtv.cn/live/1735546697341033.m3u8"}]},
  {id:"x007",no:36,name:"楚雄新闻",group:"新闻资讯",logo:"楚",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://hwapi.yntv.net/ew265l/848y54.m3u8"}]},
  {id:"x008",no:37,name:"东莞综合新闻",group:"新闻资讯",logo:"东",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://stream.sun0769.com/dgrtv1/mp4tv1_1500.flv"}]},
  {id:"x010",no:38,name:"哈尔滨综合新闻",group:"新闻资讯",logo:"哈",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://stream.hrbtv.net/xwzh/playlist.m3u8?_upt=ef41dd531755913594"}]},
  {id:"x012",no:39,name:"荆门综合新闻",group:"新闻资讯",logo:"荆",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://stream.jmtv.com.cn/xwzh/sd/live.m3u8?_upt=341f4b8e1791883036"}]},
  {id:"x029",no:40,name:"新闻世界",group:"新闻资讯",logo:"新",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://amg01076-lightning-amg01076c5-rakuten-us-1788.playouts.now.amagi.tv/playlist/amg01076-lightning-newsworld-rakutenus/playlist.m3u8"}]},
  {id:"x030",no:41,name:"福州新闻综合",group:"新闻资讯",logo:"F",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://live.zohi.tv/video/s10001-fztv-1/index.m3u8"}]},
  {id:"x004",no:42,name:"上虞新闻综合",group:"新闻资讯",logo:"上",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://l.cztvcloud.com/channels/lantian/SXshangyu1/720p.m3u8"}]},
  {id:"x031",no:43,name:"余姚新闻综合",group:"新闻资讯",logo:"余",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://l.cztvcloud.com/channels/lantian/SXyuyao1/720p.m3u8"}]},
  {id:"x015",no:44,name:"江津新闻综合",group:"新闻资讯",logo:"江",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://222.179.155.21:1935/ch1.m3u8"}]},
  {id:"x021",no:45,name:"浙江新闻",group:"新闻资讯",logo:"浙",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://ali-m-l.cztv.com/channels/lantian/channel007/1080p.m3u8"}]},
  {id:"x025",no:46,name:"湘潭新闻综合",group:"新闻资讯",logo:"湘",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://live.hnxttv.com:9601/live/xwzh/800K/tzwj_video.m3u8"}]},
  {id:"x027",no:47,name:"萧山新闻综合",group:"新闻资讯",logo:"萧",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://l.cztvcloud.com/channels/lantian/SXxiaoshan1/720p.m3u8"}]},
  {id:"x011",no:48,name:"哈尔滨影视",group:"影视剧场",logo:"哈",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://stream.hrbtv.net/yspd/playlist.m3u8"}]},
  {id:"x032",no:49,name:"新昌休闲影视",group:"影视剧场",logo:"新",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://l.cztvcloud.com/channels/lantian/SXxinchang2/720p.m3u8"}]},
  {id:"x017",no:50,name:"绍兴影视",group:"影视剧场",logo:"浙",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://live.shaoxing.com.cn/video/s10001-sxtv3/index.m3u8"}]},
  {id:"x001",no:51,name:"福州少儿",group:"少儿动画",logo:"F",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://live.zohi.tv/video/s10001-fztv-4/index.m3u8"}]},
  {id:"x033",no:52,name:"之江纪录",group:"纪录科教",logo:"之",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://ali-m-l.cztv.com/channels/lantian/channel012/1080p.m3u8"}]},
  {id:"cn091",no:53,name:"MTV 中文",group:"音乐娱乐",logo:"M",color:"#8E44AD",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://7xshreeshyam.akamaized.net/7XPunjabi/index.m3u8"}]},
  {id:"cn096",no:54,name:"第一财经",group:"财经生活",logo:"第",color:"#16A085",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://30a-tv.com/feeds/xodglobal/30atv.m3u8"}]},
  {id:"x034",no:57,name:"宜昌三峡旅游生活",group:"财经生活",logo:"宜",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://liveplay.ycrmt.cn/sxgd/lysh.m3u8"}]},
  {id:"x002",no:58,name:"福州生活",group:"财经生活",logo:"F",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://live.zohi.tv/video/s10001-fztv-3/index.m3u8"}]},
  {id:"x016",no:59,name:"江津经济生活",group:"财经生活",logo:"江",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://222.179.155.21:1935/ch0.m3u8"}]},
  {id:"x028",no:60,name:"萧山生活",group:"财经生活",logo:"蕭",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://l.cztvcloud.com/channels/lantian/SXxiaoshan2/720p.m3u8"}]},
  {id:"net003",no:61,name:"Bread TV",group:"网络直播",logo:"中",color:"#E67E22",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://video.bread-tv.com:8091/hls-live24/online/index.m3u8"}]},
  {id:"x009",no:62,name:"广州广播电视台",group:"网络直播",logo:"广",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://tencentplaybusiness.gztv.com/live/zonghes.m3u8"}]},
  {id:"x014",no:63,name:"青岛二套",group:"网络直播",logo:"青",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://video10.qtv.com.cn/drm/qtv2at/manifest.m3u8"}]},
  {id:"x035",no:64,name:"青岛五套",group:"网络直播",logo:"青",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://video10.qtv.com.cn/drm/qtv5at/manifest.m3u8"}]},
  {id:"x036",no:65,name:"宜昌三峡综合",group:"网络直播",logo:"宜",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://liveplay.ycrmt.cn/sxgd/zhpd.m3u8"}]},
  {id:"x037",no:66,name:"上虞新商都",group:"网络直播",logo:"上",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://l.cztvcloud.com/channels/lantian/SXshangyu3/720p.m3u8"}]},
  {id:"x038",no:67,name:"上虞经济文化",group:"网络直播",logo:"上",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://l.cztvcloud.com/channels/lantian/SXshangyu2/720p.m3u8"}]},
  {id:"x039",no:68,name:"余姚姚江文化",group:"网络直播",logo:"余",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://l.cztvcloud.com/channels/lantian/SXyuyao3/720p.m3u8"},{label:"备用线路 1",url:"https://l.cztvcloud.com/channels/lantian/SXyuyao2/720p.m3u8"}]},
  {id:"x040",no:69,name:"嵊州综合",group:"网络直播",logo:"嵊",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://l.cztvcloud.com/channels/lantian/SXshengzhou1/720p.m3u8"}]},
  {id:"x041",no:70,name:"新昌新闻综合",group:"网络直播",logo:"新",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://l.cztvcloud.com/channels/lantian/SXxinchang1/720p.m3u8"}]},
  {id:"x018",no:71,name:"绍兴综合",group:"网络直播",logo:"浙",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"http://live.shaoxing.com.cn/video/s10001-sxtv1/index.m3u8"}]},
  {id:"x042",no:72,name:"浙江国际",group:"网络直播",logo:"浙",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://ali-m-l.cztv.com/channels/lantian/channel010/1080p.m3u8"}]},
  {id:"x043",no:73,name:"浙江教科",group:"网络直播",logo:"浙",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://ali-m-l.cztv.com/channels/lantian/channel004/1080p.m3u8"}]},
  {id:"x044",no:74,name:"浙江民生",group:"网络直播",logo:"浙",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://ali-m-l.cztv.com/channels/lantian/channel006/1080p.m3u8"}]},
  {id:"x045",no:75,name:"浙江经济",group:"网络直播",logo:"浙",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://ali-m-l.cztv.com/channels/lantian/channel003/1080p.m3u8"}]},
  {id:"x024",no:76,name:"浙江钱江",group:"网络直播",logo:"浙",color:"#3D7EAA",epg:EPG_DOC,net:true,sources:[{label:"直播主源",url:"https://ali-m-l.cztv.com/channels/lantian/channel002/1080p.m3u8"}]},
  {id:"cn101",no:1000,name:"北京卫视",group:"卫视频道",logo:"北",color:"#0F766E",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://120.76.248.139/live/bfgd/4200000083.m3u8"}]},
  {id:"cn102",no:1001,name:"东方卫视",group:"卫视频道",logo:"东",color:"#1D4ED8",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://bp-resource-dfl.bestv.cn/148/3/video.m3u8"},{label:"备用线路 1",url:"http://bp-resource-dfl.bestv.cn/148/3/video.m3u8"},{label:"备用线路 2",url:"https://bp-resource-dfl.bestv.cn/148/3/video.m3u8"}]},
  {id:"cn103",no:1002,name:"广东卫视",group:"卫视频道",logo:"广",color:"#7C3AED",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://txmov2.a.kwimgs.com/upic/2023/01/26/09/BMjAyMzAxMjYwOTE3NDVfNzM5MzQzNzIyXzk0NjI1OTUwNTA3XzBfMw==_b_B81ddda927d33445d544befd008e60109.mp4"}]},
  {id:"cn104",no:1003,name:"贵州卫视",group:"卫视频道",logo:"贵",color:"#B91C1C",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://live.264788.xyz/channel/guizhouweishi?streamid=091bd59ea031989839c23459bb8cc9d4&livekey=01WgOR41rriMmMkzNsd0UoaxJRwetZdxIvtVk"}]},
  {id:"cn105",no:1004,name:"海南卫视",group:"卫视频道",logo:"海",color:"#0369A1",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://120.76.248.139/live/bfgd/4200000473.m3u8"}]},
  {id:"cn106",no:1005,name:"湖北卫视",group:"卫视频道",logo:"湖",color:"#A16207",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://120.76.248.139/live/bfgd/4200000102.m3u8"}]},
  {id:"cn107",no:1006,name:"吉林卫视",group:"卫视频道",logo:"吉",color:"#15803D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://221.7.175.154:8445/tsfile/live/1014_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn108",no:1007,name:"江苏卫视",group:"卫视频道",logo:"江",color:"#9D174D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://125.43.249.76:9901/tsfile/live/1030_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn109",no:1008,name:"江西卫视",group:"卫视频道",logo:"江",color:"#0F766E",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://112.27.5.218:9901/tsfile/live/faacts/0138_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn110",no:1009,name:"辽宁卫视",group:"卫视频道",logo:"辽",color:"#1D4ED8",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://61.136.172.236:9901/tsfile/live/0121_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn111",no:1010,name:"宁夏卫视",group:"卫视频道",logo:"宁",color:"#7C3AED",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://live.264788.xyz/channel/ningxiaweishi?streamid=e1236348f815c36a0429357e5b5c5f10&livekey=01WgOR41rriMmMkzNsd0UoaxJRwetZdxIvtVk"}]},
  {id:"cn112",no:1011,name:"青海卫视",group:"卫视频道",logo:"青",color:"#B91C1C",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://120.76.248.139/live/bfgd/4200000111.m3u8"}]},
  {id:"cn113",no:1012,name:"山东卫视",group:"卫视频道",logo:"山",color:"#0369A1",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://120.76.248.139/live/bfgd/4200000099.m3u8"}]},
  {id:"cn114",no:1013,name:"深圳卫视",group:"卫视频道",logo:"深",color:"#A16207",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://120.76.248.139/live/bfgd/4200000100.m3u8"}]},
  {id:"cn115",no:1014,name:"四川卫视",group:"卫视频道",logo:"四",color:"#15803D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"https://live.264788.xyz/channel/sichuanweishi4k?streamid=401bf692a1a8b91298f26077d53316d6&livekey=01WgOR41rriMmMkzNsd0UoaxJRwetZdxIvtVk"}]},
  {id:"cn116",no:1015,name:"天津卫视",group:"卫视频道",logo:"天",color:"#9D174D",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://222.169.85.8:9901/tsfile/live/0135_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn117",no:1016,name:"云南卫视",group:"卫视频道",logo:"云",color:"#0F766E",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://120.76.248.139/live/bfgd/4200000482.m3u8"}]},
  {id:"cn118",no:1017,name:"黑龙江卫视",group:"卫视频道",logo:"黑",color:"#1D4ED8",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://120.76.248.139/live/bfgd/4200000095.m3u8"}]},
  {id:"cn119",no:1018,name:"河南卫视",group:"卫视频道",logo:"豫",color:"#B45309",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://119.39.9.8:9901/tsfile/live/0139_1.m3u8?key=txiptv&playlive=0&authid=0"},{label:"备用线路 1",url:"http://36.136.38.87:9901/tsfile/live/0139_1.m3u8?key=txiptv&playlive=1&authid=0"},{label:"备用线路 2",url:"http://221.7.175.154:8445/tsfile/live/0139_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn120",no:1019,name:"重庆卫视",group:"卫视频道",logo:"渝",color:"#0E7490",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://112.123.243.37:50085/tsfile/live/0131_1.m3u8?key=txiptv&playlive=0&authid=0"},{label:"备用线路 1",url:"http://221.7.175.154:8445/tsfile/live/0142_1.m3u8?key=txiptv&playlive=1&authid=0"},{label:"备用线路 2",url:"http://60.187.246.34:85/tsfile/live/0142_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
  {id:"cn121",no:1020,name:"福建卫视",group:"卫视频道",logo:"闽",color:"#1E40AF",epg:EPG_NEWS,net:true,sources:[{label:"直播主源",url:"http://120.76.248.139/live/bfgd/4200000483.m3u8"},{label:"备用线路 1",url:"http://124.90.45.52:9901/tsfile/live/0137_1.m3u8?key=txiptv&playlive=1&authid=0"},{label:"备用线路 2",url:"http://60.187.246.34:85/tsfile/live/0137_1.m3u8?key=txiptv&playlive=1&authid=0"}]},
];
var LIVE_MISSING = ["ABN 中国", "CCTV+ 1", "CGTN Spanish", "CGTN 商业", "CGTN 法语", "CGTN 纪录", "CGTN 阿语", "KIX 频道", "中国旅游", "兴隆综合", "发现中国", "天使卫视", "宠物俱乐部", "港台电视 31", "潮州公共频道", "美善人生台", "荣昌综合", "靖江新闻綜合"];
/* 仓自带直播源：lives 的 url 通常是「频道名,地址」的 txt 清单，拉下来解析并入 LIVE_CHANNELS */
var WH_LIVE_CH_CACHE = 'kh_wh_live_channels';
function khWhLiveMerge(list) {
  for (var i = LIVE_CHANNELS.length - 1; i >= 0; i--) {
    if (LIVE_CHANNELS[i] && LIVE_CHANNELS[i].whLive) LIVE_CHANNELS.splice(i, 1);
  }
  if (!Array.isArray(list) || !list.length) return 0;
  var n = 0;
  for (var j = 0; j < list.length && n < 200; j++) {
    var c = list[j];
    if (!c || !/^https?:\/\//i.test(String(c.url || ''))) continue;
    var nm = String(c.name || ('仓直播' + (n + 1))).trim().slice(0, 24);
    LIVE_CHANNELS.push({
      id: 'whlv' + (n + 1), no: LIVE_CHANNELS.length + 1, name: nm,
      group: String(c.group || '仓直播').trim().slice(0, 18),
      logo: nm.slice(0, 1), color: '#25A36F', epg: '仓直播', net: true,
      whLive: 1, whName: String(c.whName || ''),
      sources: [{ label: '仓直播源', url: String(c.url).slice(0, 500) }]
    });
    n++;
  }
  return n;
}
function parseLiveTxt(txt, whInfo) {
  var out = [], group = '仓直播';
  var lines = String(txt || '').split(/\r?\n/);
  for (var i = 0; i < lines.length && out.length < 120; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) === '#') continue;
    if (/,#genre#$/i.test(line)) { group = line.split(',')[0].trim().slice(0, 16) || group; continue; }
    var m = line.match(/^([^,]+),(\s*https?:\/\/.+)$/i);
    if (!m) continue;
    out.push({ name: m[1].trim().slice(0, 24), url: m[2].trim().slice(0, 500), group: (whInfo.whName ? whInfo.whName + ' · ' : '') + group, whName: whInfo.whName || '' });
  }
  return out;
}
function khSyncWhLives(done) {
  var cache = getStore(WH_LIVE_CH_CACHE, null);
  khWhLiveMerge(cache || []);
  var lm = getStore(WH_LIVES_KEY, null) || {}, jobs = [];
  for (var k in lm) {
    if (!Object.prototype.hasOwnProperty.call(lm, k) || !Array.isArray(lm[k])) continue;
    for (var i = 0; i < lm[k].length && i < 20; i++) jobs.push(lm[k][i]);
  }
  if (!jobs.length) { if (done) done(0); return; }
  var idx = 0, res = [], busy = 0;
  function next() {
    while (busy < 3 && idx < jobs.length) {
      (function (job) {
        busy++;
        var p = (typeof window !== 'undefined' && window.KH_SRC && KH_SRC.getText)
          ? KH_SRC.getText(job.url).then(function (t) { return parseLiveTxt(t, job); }).catch(function () { return []; })
          : Promise.resolve([]);
        p.then(function (list) {
          for (var q = 0; q < list.length; q++) res.push(list[q]);
          busy--;
          next();
        });
      })(jobs[idx++]);
    }
    if (idx >= jobs.length && busy === 0) {
      setStore(WH_LIVE_CH_CACHE, res);
      var n = khWhLiveMerge(res);
      if (done) done(n);
    }
  }
  next();
}
function khSrcCount(){ var n=0; for(var i=0;i<LIVE_CHANNELS.length;i++) n += LIVE_CHANNELS[i].sources.length; return n; }
function khMultiCount(){ var n=0; for(var i=0;i<LIVE_CHANNELS.length;i++) if(LIVE_CHANNELS[i].sources.length>1) n++; return n; }
function khLiveGroups(){ var out=[], seen={}; for(var i=0;i<LIVE_CHANNELS.length;i++){ var g=LIVE_CHANNELS[i].group; if(!seen[g]){ seen[g]=1; out.push(g); } } return out; }
var LIVE_GROUPS = ["全部", "央视频道", "卫视频道", "中国港澳台地区", "体育竞技", "新闻资讯", "影视剧场", "少儿动画", "纪录科教", "音乐娱乐", "财经生活", "网络直播", "我添加的", "已收藏"];

function epgFor(ch, d){
  var pool = ch.epg && ch.epg.length ? ch.epg : EPG_NEWS;
  var mins = d.getHours() * 60 + d.getMinutes();
  var slot = Math.floor(mins / 30);
  var i = ((slot + ch.no * 3) % pool.length + pool.length) % pool.length;
  return {now:pool[i], next:pool[(i + 1) % pool.length], pct:((mins % 30) / 30) * 100};
}
function getLive(){
  var v = getStore('kh_live', []);
  if(!Array.isArray(v)){ setStore('kh_live', []); return []; }
  var out = [];
  for(var i=0;i<v.length;i++){
    var s = v[i];
    if(s && typeof s.name === 'string' && typeof s.url === 'string' && /^https?:\/\//i.test(s.url)){
      out.push({name:s.name.slice(0,20), url:s.url, group:typeof s.group === 'string' ? s.group.slice(0,12) : '我添加的'});
    }
  }
  return out;
}
function getLiveFav(){ return strArray('kh_livefav'); }
function normalizeStreamUrl(raw){
  var u = String(raw || '').trim();
  if(!u) return '';
  if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try{
    var p = new URL(u);
    if(p.protocol !== 'http:' && p.protocol !== 'https:') return '';
    if(!p.hostname) return '';
    return p.href;
  }catch(e){ return ''; }
}

/* ---------------- 直播源自动检测 · 自动优化 · 云端自动更新 ----------------
   1) 每次播放都是一次真机体检：失败自动降权、成功自动提权（kh_src_health_v1）；
   2) 起播按健康分排序，已知坏源排到最后，不再从死链开始（rankSources）；
   3) 源清单可由云端下发覆盖内置 LIVE_CHANNELS，启动 + 每 10 分钟自动刷新，
      修源后无需重装 HAP；离线时回落到上次成功覆盖 + 随包基线。            */
var SRC_HEALTH_KEY = 'kh_src_health_v1';
var SRC_OVERRIDE_KEY = 'kh_src_override_v1';
var SRC_META_KEY = 'kh_src_meta_v1';

function srcHealth(){
  var h = getStore(SRC_HEALTH_KEY, {});
  return (h && typeof h === 'object') ? h : {};
}
function markSrc(url, ok){
  if(!url || typeof url !== 'string') return;
  var h = srcHealth();
  var r = h[url] || {ok:0, fail:0};
  var now = Date.now();
  if(ok){
    r.ok = Math.min(999, (r.ok || 0) + 1); r.fail = 0; r.ban = 0; r.last = now;
  } else {
    r.fail = Math.min(999, (r.fail || 0) + 1);
    issuePush('源', '片源加载失败（连续 ' + r.fail + ' 次）：' + String(url).slice(0, 90), {url:url});
    if(r.fail >= 2) r.ban = now;          // 连败 2 次进入 30 分钟降权冷却
    r.last = now;
  }
  h[url] = r;
  var keys = Object.keys(h);
  if(keys.length > 400){
    keys.sort(function(a,b){ return (h[a].last || 0) - (h[b].last || 0); });
    for(var i=0;i<keys.length-300;i++) delete h[keys[i]];
  }
  setStore(SRC_HEALTH_KEY, h);
}
function srcHealthStat(){
  var h = srcHealth(), good = 0, bad = 0, now = Date.now();
  for(var k in h){
    if(!Object.prototype.hasOwnProperty.call(h,k)) continue;
    if(h[k].ban && (now - h[k].ban) < 1800000) bad++;
    else if(h[k].ok > 0) good++;
  }
  return {good:good, bad:bad};
}
function rankSources(ch){
  var srcs = (ch && ch.sources) ? ch.sources.slice() : [];
  if(srcs.length < 2) return srcs;
  var h = srcHealth(), now = Date.now(), arr = [];
  for(var i=0;i<srcs.length;i++){
    var r = h[srcs[i].url] || {};
    var banned = r.ban && (now - r.ban) < 1800000;
    var sc = banned ? -1000 : (r.ok || 0) * 10 - (r.fail || 0) * 3;
    arr.push({s:srcs[i], i:i, sc:sc});
  }
  arr.sort(function(a,b){ return (b.sc - a.sc) || (a.i - b.i); });
  var out = [];
  for(var j=0;j<arr.length;j++) out.push(arr[j].s);
  return out;
}
function srcMeta(){
  var m = getStore(SRC_META_KEY, {});
  return (m && typeof m === 'object') ? m : {};
}
function sourceStatusLine(){
  var m = srcMeta(), st = srcHealthStat();
  var v = m.v ? ('v' + m.v) : '随包基线';
  var t = m.appliedAt ? new Date(m.appliedAt).toLocaleTimeString('zh-CN', {hour12:false}) : '尚未联网更新';
  return '源清单 ' + v + ' · ' + t + ' · 实测可用 ' + st.good + ' 路 / 自动降权 ' + st.bad + ' 路';
}
/* 只替换已存在频道的 sources，不新增/删除频道：避免缺 epg/color 等渲染字段 */
var SITES_CLOUD_KEY = 'kh_sites_cloud_v1';
/* 云端清单可同时下发内置平台、检索模板与红果直达地址；本地持久化，重启后仍生效。
   校验字段与 URL 协议，避免坏数据把页面打崩。 */
function applySiteData(data, from){
  if(window.KH_STORE) return 0;   /* 商店变体：不接受任何平台清单（含云端下发） */
  if(!data || !Array.isArray(data.sites) || !data.sites.length) return 0;
  var out = [];
  for(var i=0;i<data.sites.length && i<240;i++){
    var x = data.sites[i];
    if(!x || typeof x.name !== 'string' || typeof x.url !== 'string') continue;
    if(!/^https?:\/\//i.test(x.url)) continue;
    var row = {
      name: x.name.slice(0,24), url: x.url.slice(0,512),
      color: (typeof x.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(x.color)) ? x.color : '#3B456B',
      tag: (typeof x.tag === 'string' && x.tag) ? x.tag.slice(0,2) : x.name.slice(0,1),
      cat: (typeof x.cat === 'string' && x.cat) ? x.cat.slice(0,20) : '综合视频'
    };
    if(typeof x.mobile === 'string' && /^https?:\/\//i.test(x.mobile)) row.mobile = x.mobile.slice(0,512);
    if(typeof x.mode === 'string' && PLAT_MODE[x.mode]) row.mode = x.mode;
    out.push(row);
  }
  if(!out.length) return 0;
  BUILTIN_SITES = out;
  if(data.searchTpl && typeof data.searchTpl === 'object' && !Array.isArray(data.searchTpl)){
    SEARCH_TPL = data.searchTpl;
  }
  if(data.quick && typeof data.quick === 'object' && !Array.isArray(data.quick)){
    window.KH_QUICK = data.quick;
  }
  /* 远程收集端点可随云端清单热更新下发。1.7.107 起默认开启外发（仅脱敏摘要），
     用户在问题中心点关闭即停发；没有下发地址时 url 为空、不会盲发。
     1.7.106：客户纯净版也接受清单下发的地址（此前被 KH_UI_CLEAN 挡掉，客户手上连地址都没有，
     只能口头抄一段 URL，实际等于收不到）。注意这里只写「地址」，外发开关仍由
     issueRemoteCfg().enabled 决定，客户版默认 false —— 客户点一下才真的发。 */
  if(typeof data.remoteUrl === 'string' && /^https?:\/\//i.test(data.remoteUrl)){
    ISSUE_REMOTE_DEFAULT = data.remoteUrl.slice(0, 300);
  }
  setStore(SITES_CLOUD_KEY, {v:Number(data.v||0), sites:out,
    searchTpl:data.searchTpl || null, quick:data.quick || null});
  try{ console.log('[自动更新] 平台清单已应用：' + out.length + ' 个 · 来源 ' + (from || '-')); }catch(e){}
  if(typeof state !== 'undefined' && state && !state.movie) render();
  return out.length;
}
function applySourceData(data, from){
  if(window.KH_STORE) return 0;   /* 商店变体：不接受直播/源清单下发 */
  if(!data || typeof data !== 'object' || !Array.isArray(data.channels)) return 0;
  var v = Number(data.v || 0);
  if(!isFinite(v) || v < 0) return 0;
  var cur = srcMeta();
  if(v && cur.v && v <= cur.v && from !== 'local'){
    try{ console.log('[自动更新] 已是最新源清单 v' + cur.v + '（云端 v' + v + '）'); }catch(e){}
    return -1;   // 幂等：不回退旧版
  }
  var map = {};
  for(var i=0;i<LIVE_CHANNELS.length;i++) map[LIVE_CHANNELS[i].id] = i;
  var hit = 0;
  for(var j=0;j<data.channels.length;j++){
    var c = data.channels[j];
    if(!c || typeof c.id !== 'string' || !Array.isArray(c.sources) || !c.sources.length) continue;
    var at = map[c.id];
    if(at === undefined) continue;
    var ss = [];
    for(var k=0;k<c.sources.length && k<6;k++){
      var so = c.sources[k];
      if(so && typeof so.url === 'string' && /^https?:\/\//i.test(so.url)){
        ss.push({label: (typeof so.label === 'string' && so.label) ? so.label.slice(0,24) : ('线路 ' + (k+1)), url:so.url});
      }
    }
    if(!ss.length) continue;
    LIVE_CHANNELS[at].sources = ss;
    hit++;
  }
  var siteHit = applySiteData(data, from);
  if(!hit && !siteHit) return 0;
  setStore(SRC_META_KEY, {v:v, updatedAt:data.updatedAt || '', appliedAt:Date.now(), from:from || '', count:hit});
  setStore(SRC_OVERRIDE_KEY, {v:v, updatedAt:data.updatedAt || '', channels:data.channels});
  try{ console.log('[自动更新] ' + hit + ' 个频道已应用 ' + (v ? 'v'+v : '基线') + ' · 来源 ' + (from || '-')); }catch(e){}
  if(typeof state !== 'undefined' && state && !state.movie) render();
  return hit;
}
function readEmbeddedSources(){
  try{
    var el = document.getElementById('kh-sources');
    if(!el) return;
    var txt = (el.textContent || '').trim();
    if(!txt) return;
    var d = JSON.parse(txt), cur = srcMeta();
    if(!cur.v || (d.v && d.v > cur.v)) applySourceData(d, 'package');
  }catch(e){}
}
/* 原生桥注入入口：云端清单以 JSON 字符串传入，避免脚本转义问题 */
window.__khApplySources = function(txt){
  try{
    var d = (typeof txt === 'string') ? JSON.parse(txt) : txt;
    var n = applySourceData(d, 'cloud');
    /* 云端清单里 channels 与 sites 是一起下发的。过去这里只应用 channels，
       平台清单永远停在包内 29 个（服务端已到 144 个），属于热更新断链。 */
    var sn = 0;
    try{ if(d && typeof d === 'object' && Array.isArray(d.sites) && d.sites.length) sn = applySiteData(d, 'cloud'); }catch(e2){}
    if(n > 0 || sn > 0){
      toast('已同步云端清单：' + (n > 0 ? n + ' 个频道' : '') +
        (n > 0 && sn > 0 ? ' · ' : '') + (sn > 0 ? sn + ' 个平台' : ''));
    }
    return String(n);
  }catch(e){
    try{ console.log('[自动更新] 配置解析失败 ' + (e && e.message ? e.message : '')); }catch(e2){}
    return '0';
  }
};
function requestSourceUpdate(){
  try{
    if(window.KaihongBridge && typeof window.KaihongBridge.refreshSources === 'function'){
      window.KaihongBridge.refreshSources();
    } else {
      readEmbeddedSources();
      toast('已检查随包源清单（当前为浏览器预览）');
    }
  }catch(e){ issuePush('清单', '云端清单检查异常：' + (e && e.message ? e.message : '未知错误')); }
}


/* ---------------- 设备自适应 · 版本自动跟进 ----------------
   原生侧注入设备指纹（机型/ABI/开鸿系统/API/屏幕），云端清单下发按档位的调优参数，
   应用据此选择看门狗超时、渲染开销与并发策略；同一 HAP 在 2in1 / 平板 / 开发板 / TV
   上自动匹配，不需要为每种电脑单独发包。版本清单每次联网自动比对，发现新版提示更新。 */
window.KH_DEVICE = null;
window.KH_TUNE = null;
window.KH_RELEASE = null;
/* 离线基线：中枢连不上时，回落到随包内嵌的版本清单，版本行/兼容判定不至于显示「未知」。
   联网后 /api/manifest 下发的清单会覆盖它；基线只用于展示，不据此弹更新横幅。 */
try{
  var _relBase = document.getElementById('kh-release');
  if(_relBase && !window.KH_RELEASE){
    var _rb = JSON.parse(_relBase.textContent || 'null');
    if(_rb && _rb.latest) window.KH_RELEASE = _rb;
  }
}catch(e){}
var KH_DEFAULT_TUNE = {
  low:  {watchdogMs:9000, concurrency:2, lazyPx:1000, columns:2, label:'低配'},
  mid:  {watchdogMs:7500, concurrency:4, lazyPx:1800, columns:3, label:'标准'},
  high: {watchdogMs:6500, concurrency:6, lazyPx:2600, columns:4, label:'高配'}
};
function khTune(){ return window.KH_TUNE || KH_DEFAULT_TUNE.mid; }
function khDeviceLine(){
  var d = window.KH_DEVICE;
  if(!d) return '设备信息由真机原生侧注入（当前为浏览器预览）';
  var r = window.KH_RELEASE && window.KH_RELEASE.latest;
  return d.tier + '档 · ' + d.screenW + '×' + d.screenH + ' · API' + d.apiVersion +
         ' · v' + d.appVersion + (r ? ' / 云端 v' + r.versionName : '');
}
window.__khSetDeviceProfile = function(p){
  try{
    if(!p || typeof p !== 'object') return;
    window.KH_DEVICE = p;
    var tier = (p.tier === 'low' || p.tier === 'high') ? p.tier : 'mid';
    window.KH_TUNE = KH_DEFAULT_TUNE[tier];
    try{ document.body.setAttribute('data-tier', tier); }catch(e){}
    try{
      if(!document.getElementById('khTierStyle')){
        var st = document.createElement('style'); st.id = 'khTierStyle';
        st.textContent = 'body[data-tier="low"] *{animation:none!important;transition:none!important;' +
          'box-shadow:none!important;text-shadow:none!important}';
        document.head.appendChild(st);
      }
    }catch(e){}
    try{ console.log('[设备适配] ' + (p.marketName || p.model) + ' / ' + (p.osFullName || '') +
      ' / API' + p.apiVersion + ' / ' + window.KH_TUNE.label + '档 / ' + p.screenW + 'x' + p.screenH); }catch(e){}
    if(typeof render === 'function') render();
  }catch(e){}
};
/* ---- 自动升级安装：原生 AutoUpdater 回传状态，页面只负责呈现 ---- */
window.KH_UPGRADE = null;
/* 差分更新（#67）：清单 latest.delta 为可选增量包数组 [{from,to,url,sha256,size}]。
   这里只做版本匹配与可用性标注；增量包的生成与合并属发布/原生链路，
   在发布端尚未产出可校验增量包前，安装动作仍走整包兜底，不假装已支持增量。 */
function khMatchDelta(latest, curCode){
  try{
    var deltas = latest && latest.delta;
    if(!Array.isArray(deltas) || !deltas.length) return null;
    curCode = Number(curCode) || 0;
    for(var i=0;i<deltas.length;i++){
      var d = deltas[i];
      if(d && Number(d.from) === curCode && Number(d.to) === Number(latest.versionCode) && d.url) return d;
    }
  }catch(e){}
  return null;
}
/* ---- 升级阶段状态机 / 失败归类 / 预检 / 差分选路（#104/#105）----
   阶段枚举：check 检查中 · download 下载中 · verify 校验中 · install 安装中 · done 已完成 · failed 失败。
   二进制断点续传与差分包合并属原生/发布端链路；前端只做阶段呈现、失败归类、安装前预检与失败回退下载页，
   不在网页层假装可直接续传安装包。 */
var KH_UPGRADE_STAGES = {check:'检查中',download:'下载中',verify:'校验中',install:'安装中',done:'已完成',failed:'失败'};
function khUpgradeFailKind(err){
  var s = String(err == null ? '' : (err.message || err));
  if(/取消|cancel/i.test(s)) return 'cancel';
  if(/占用|locked|in use|正在运行|忙/i.test(s)) return 'locked';
  if(/校验|sha256|hash|完整性|体积|损坏|corrupt/i.test(s)) return 'verify';
  if(/版本|降级|downgrade|旧版/i.test(s)) return 'version';
  if(/空间|磁盘|disk|不足/i.test(s)) return 'disk';
  if(/失败|错误|超时|timeout|network|fetch|连接|网络|502|503/i.test(s)) return 'network';
  return 'unknown';
}
function khUpgradeTelemetry(stage, extra){
  try{ var _x = window.KH_EXTRAS; if(_x && typeof _x.tel === 'function') _x.tel(stage, extra); }catch(e){}
}
/* 下载进度轮询（#115）：download/verify 阶段每秒读一次服务端进度，把百分比并入状态条；
   本地已有安装包或走系统安装器时进度为 0，不显示假百分比。 */
var _khUpProgTimer = null;
function khUpgradeStopProgress(){ if(_khUpProgTimer){ clearInterval(_khUpProgTimer); _khUpProgTimer = null; } }
function khUpgradePollProgress(){
  if(_khUpProgTimer) return;
  _khUpProgTimer = setInterval(function(){
    fetch('/api/update/progress', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(d){
      if(!d || !d.ok) return;
      var u = window.KH_UPGRADE || {};
      if(u.stage === 'download' || u.stage === 'verify'){
        window.KH_UPGRADE = Object.assign({}, u, { percent: d.percent, received: d.received, total: d.total });
        khUpgradePaint();
      }
    }).catch(function(){});
  }, 1000);
}
function khUpgradeSetStage(stage, message, extra){
  try{
    var u = window.KH_UPGRADE || {};
    window.KH_UPGRADE = Object.assign({}, u, {stage:stage, message:String(message || ''), at:Date.now()}, extra || {});
    if(stage === 'download' || stage === 'verify'){ khUpgradePollProgress(); }
    else { khUpgradeStopProgress(); }
    if(stage === 'done'){ khNotifyPush('更新完成', String(message || '新版本安装向导已启动')); }
    khUpgradePaint();
    if(stage === 'failed'){
      var kind = khUpgradeFailKind(message);
      issuePush('升级', '[' + kind + '] ' + message);
      khUpgradeTelemetry('failed', Object.assign({ok:false, failKind:kind}, extra || {}));
    } else {
      khUpgradeTelemetry(stage, Object.assign({ok:true}, extra || {}));
    }
  }catch(e){}
}
/* 安装前预检：降级保护 / 系统 API 兼容 / 磁盘空间。回滚安装由调用方显式 rollback 标记，跳过降级保护。 */
function khUpgradePrecheck(latest, opts){
  opts = opts || {};
  var cur = Number(window.KH_DEVICE && window.KH_DEVICE.appCode) || Number(KH_APP_CODE) || 0;
  var tgt = Number(latest && latest.versionCode) || 0;
  if(!opts.rollback && tgt > 0 && cur > 0 && tgt < cur){
    return {ok:false, kind:'version', reason:'目标版本 v' + (latest && latest.versionName) + ' 低于当前版本，已拦截降级（如需回滚请走归档回滚）'};
  }
  var dev = window.KH_DEVICE;
  if(dev && latest && latest.minApi && Number(dev.apiVersion) > 0 && Number(dev.apiVersion) < Number(latest.minApi)){
    return {ok:false, kind:'version', reason:'当前系统 API ' + dev.apiVersion + ' 低于要求 API ' + latest.minApi + '，请先升级系统再安装'};
  }
  var ei = window.KH_ENV_INFO;
  var FREE_MIN = 200 * 1024 * 1024;
  if(ei && typeof ei.diskFreeBytes === 'number' && ei.diskFreeBytes >= 0 && ei.diskFreeBytes < FREE_MIN){
    return {ok:false, kind:'disk', reason:'磁盘空间不足：剩余约 ' + Math.round(ei.diskFreeBytes/1024/1024) + 'MB，安装包至少需 200MB 可用空间'};
  }
  return {ok:true};
}
/* 差分优先、整包兜底：命中可校验增量包走 delta，否则回退整包地址；增量包生成仍属发布端。 */
function khUpgradePickUrl(latest){
  var cur = Number(window.KH_DEVICE && window.KH_DEVICE.appCode) || Number(KH_APP_CODE) || 0;
  var delta = khMatchDelta(latest, cur);
  if(delta && delta.url) return {url:delta.url, kind:'delta', delta:delta};
  var fallback = (latest && (latest.downloadUrl || latest.hapUrl)) || '';
  return {url:fallback, kind:'full', delta:null};
}
function khUpgradeInstall(latest){
  var pre;
  try{
    pre = khUpgradePrecheck(latest, {});
    if(!pre.ok){ khUpgradeSetStage('failed', pre.reason, {failKind:pre.kind}); toast('⚠️ ' + pre.reason); return; }
  }catch(e){}
  var pick = khUpgradePickUrl(latest);
  try{
    if(window.KaihongBridge && typeof window.KaihongBridge.retryUpgrade === 'function'){
      khUpgradeSetStage('install', '正在校验安装包并拉起系统安装器…', {channel: pick.kind});
      window.KaihongBridge.retryUpgrade();
      toast('正在校验安装包并拉起系统安装器…');
      return;
    }
  }catch(e){}
  khUpgradeSetStage('download', pick.kind === 'delta' ? '优先使用增量包更新…' : '正在下载整包安装包…', {channel: pick.kind});
  khOpenUpdate(pick.url || (latest && (latest.downloadPage || latest.hapUrl)) || '');
}
function khUpgradePaint(){
  var el = document.getElementById('khUpgradeState');
  if(!el) return;
  var u = window.KH_UPGRADE;
  if(!u){ el.innerHTML = ''; return; }
  var c = u.stage === 'failed' ? '#FF9B9B' : (u.stage === 'done' ? '#6BE3A0' : '#9CC5FF');
  var label = KH_UPGRADE_STAGES[u.stage] || u.stage || '';
  var head = label ? ('[' + label + '] ') : '';
  el.innerHTML = '<span style="color:' + c + '">⚡ ' + head + esc(String(u.message || '')) + '</span>' +
    (u.percent > 0 && u.percent < 100 ? ' · ' + u.percent + '%' : '');
}
window.__khUpgradeState = function(txt){
  try{
    var u = (typeof txt === 'string') ? JSON.parse(txt) : txt;
    if(!u) return;
    window.KH_UPGRADE = u;
    try{ console.log('[自动升级] ' + u.message); }catch(e){}
    khUpgradePaint();
    if(u && /失败|错误|校验|异常/.test(String(u.message || ''))) issuePush('升级', u.message);
    if(typeof render === 'function') render();
  }catch(e){ issuePush('升级', '升级状态解析失败：' + String(txt).slice(0, 90)); }
};
function khOpenUpdate(url){
  if(!url) { toast('暂未配置更新地址'); return; }
  try{
    if(window.KaihongBridge && typeof window.KaihongBridge.openUpdatePage === 'function'){
      window.KaihongBridge.openUpdatePage(url);
    } else { window.open(url, '_blank'); }
  }catch(e){}
}
function khUpdateBar(hasNew, apiOk, latest){
  var bar = document.getElementById('khUpdateBar');
  if(!bar){
    bar = document.createElement('div'); bar.id = 'khUpdateBar';
    bar.setAttribute('style', 'position:fixed;left:0;right:0;top:0;z-index:9998;display:none;' +
      'padding:9px 14px;background:#12233B;color:#E8F1FF;font:13px/1.5 sans-serif;' +
      'box-shadow:0 2px 12px rgba(0,0,0,.35);align-items:center;gap:10px;flex-wrap:wrap');
    try{ document.body.appendChild(bar); }catch(e){ return; }
  }
  if(!hasNew){ bar.style.display = 'none'; return; }
  var _delta = khMatchDelta(latest, window.KH_DEVICE && window.KH_DEVICE.appCode);
  var txt = '🆕 发现新版本 v' + esc(latest.versionName) +
    '（当前 v' + (window.KH_DEVICE ? window.KH_DEVICE.appVersion : '?') + '）· ' +
    esc(String(latest.notes || '建议更新到最新版本')) +
    (apiOk ? ' · 当前开鸿系统兼容' : ' · 当前系统版本偏低，建议先升级系统') +
    (_delta ? ' · 增量包优先，不可用时回退整包' : ' · 整包更新');
  bar.innerHTML = '<span style="flex:1;min-width:220px">' + txt + '</span>' +
    '<span id="khUpgradeState" style="font-size:12px;color:#9CC5FF"></span>' +
    '<button id="khUpdateBtn" style="border:0;border-radius:16px;padding:6px 16px;background:#FF4D5E;' +
    'color:#fff;font-weight:700;cursor:pointer">⚡ 立即安装 / 重试</button>' +
    '<button id="khUpdateLater" style="border:0;background:transparent;color:#9AA6C4;cursor:pointer">稍后</button>';
  bar.style.display = 'flex';
  khUpgradePaint();
  var b = document.getElementById('khUpdateBtn');
  if(b) b.onclick = function(){ khUpgradeInstall(latest); };
  var l = document.getElementById('khUpdateLater');
  if(l) l.onclick = function(){ bar.style.display = 'none'; };
}
window.__khSetRelease = function(txt){
  try{
    var r = (typeof txt === 'string') ? JSON.parse(txt) : txt;
    if(!r || !r.latest) return;
    window.KH_RELEASE = r;
    var d = window.KH_DEVICE, latest = r.latest;
    // 云端可按档位覆盖本地默认参数：针对性更新，无需重新发版
    if(latest.variants && d && d.tier && latest.variants[d.tier]){
      var v = latest.variants[d.tier], t = khTune();
      window.KH_TUNE = {
        watchdogMs: Number(v.watchdogMs) || t.watchdogMs,
        concurrency: Number(v.concurrency) || t.concurrency,
        lazyPx: Number(v.lazyPx) || t.lazyPx,
        columns: Number(v.columns) || t.columns,
        label: t.label
      };
    }
    var cur = d ? Number(d.appCode) : 0;
    var hasNew = cur > 0 && Number(latest.versionCode) > cur;
    var apiOk = !d || !latest.minApi || Number(d.apiVersion) >= Number(latest.minApi);
    try{ state.delta = khMatchDelta(latest, cur); }catch(e){ state.delta = null; }
    try{ console.log('[版本检查] 当前 v' + (d ? d.appVersion : '?') + ' / 云端 v' + latest.versionName +
      (hasNew ? ' · 发现新版' : ' · 已是最新') + ' / 系统' + (apiOk ? '兼容' : '需升级')); }catch(e){}
    khUpdateBar(hasNew, apiOk, latest);
    if(typeof state !== 'undefined' && state && !state.movie && typeof render === 'function') render();
  }catch(e){}
};
function khDeviceCardHtml(){
  var d = window.KH_DEVICE, r = window.KH_RELEASE && window.KH_RELEASE.latest, t = khTune();
  var row = function(k, v){ return '<div style="display:flex;gap:10px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.07)">' +
    '<span style="width:118px;flex:none;color:#8A93AB">' + esc(k) + '</span><span style="flex:1">' + esc(String(v)) + '</span></div>'; };
  if(!d){
    return '<p style="margin:0;color:#9AA6C4;font-size:13px">当前为浏览器预览；装机后由原生侧注入真实设备指纹，' +
      '自动匹配机型 / CPU 架构 / 开鸿系统版本并下发针对性参数。</p>';
  }
  var osOk = r ? (Number(d.apiVersion) >= Number(r.minApi || 0) ? '满足要求' : '建议升级系统') : '待云端校验';
  var newest = r ? (Number(r.versionCode) > Number(d.appCode) ? ('v' + r.versionName + '（有新版）') : ('v' + (window.KH_APP_VERSION || d.version || '') + '（已是最新）')) : '待检查';
  var h = row('设备', (d.marketName || d.model) + ' / ' + d.deviceType);
  h += row('CPU 架构', d.abi + '（纯 ArkTS 字节码，跨架构通用）');
  h += row('开鸿系统', d.osFullName);
  h += row('系统 API', 'API ' + d.apiVersion + ' · 最低 API ' + d.minApi + ' / 目标 API ' + d.targetApi + ' · ' + osOk);
  h += row('屏幕', d.screenW + '×' + d.screenH + ' @ ' + d.densityDPI + 'dpi');
  h += row('能力档位', d.tier + '（' + t.label + '）· 看门狗 ' + t.watchdogMs + 'ms · 并发 ' + t.concurrency);
  h += row('应用版本', 'v' + d.appVersion + '（code ' + d.appCode + '） / 云端最新 ' + newest);
  if(r && r.notes) h += row('本次更新', r.notes);
  var _u = window.KH_UPGRADE;
  var _us = _u ? String(_u.message || _u.stage) :
    (r && Number(r.versionCode) > Number(d.appCode) ? '云端有新版，应用正在自动下载安装包…' : '已保持最新，无需操作');
  h += row('自动升级', _us);
  h += '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="qbtn" data-act="kh-check-update">⟳ 立即检查更新</button>' +
    '<button class="qbtn" data-act="kh-upgrade-install">⚡ 立即安装 / 重试</button></div>';
  return h;
}

function liveMovieObj(ch){
  var e0 = epgFor(ch, new Date());
  return {
    id:'live_' + ch.id, live:true, channel:ch,
    title:ch.name, subtitle:ch.group, year:0, rating:0,
    category:'直播', tags:[ch.group,'电视直播'],
    desc:'正在直播：' + e0.now + '　｜　接下来：' + e0.next,
    cast:'—', color:ch.color, accent:ch.color,
    sources:rankSources(ch)
  };
}
function customChannel(s, i){
  return {
    id:'my' + i, no:i + 1, name:s.name, group:'我添加的',
    logo:(s.name || '自').slice(0,1), color:'#3B456B', epg:EPG_FILM,
    custom:true,
    sources:[{label:'自建直播源', url:s.url}]
  };
}
function allLiveChannels(){
  var out = LIVE_CHANNELS.slice();
  var mine = getLive();
  for(var i=0;i<mine.length;i++) out.push(customChannel(mine[i], i));
  return out;
}
function filteredLive(){
  var all = allLiveChannels();
  var kw = (state.liveKeyword || '').trim().toLowerCase();
  if(kw){
    all = all.filter(function(c){
      return (c.name || '').toLowerCase().indexOf(kw) >= 0 ||
             (c.group || '').toLowerCase().indexOf(kw) >= 0;
    });
  }
  var favMap = {};
  var favArr = getLiveFav();
  for(var fvi=0;fvi<favArr.length;fvi++) favMap[favArr[fvi]] = true;
  var inFav = function(c){ return !!favMap[c.id]; };
  if(state.liveGroup === '已收藏') return all.filter(inFav);
  if(state.liveGroup !== '全部') all = all.filter(function(c){ return c.group === state.liveGroup; });
  /* 收藏频道置顶，稳定排序：未收藏的保持原相对顺序 */
  return all.slice().sort(function(a,b){
    return (inFav(b) ? 1 : 0) - (inFav(a) ? 1 : 0);
  });
}
/* 性能：收藏状态由调用方一次性建表传入，避免每个频道重复解析 localStorage（155 频道曾 = 155 次 JSON.parse） */
function liveCard(ch, favSet){
  var e = epgFor(ch, new Date());
  var fav = favSet ? favSet[ch.id] === true : getLiveFav().indexOf(ch.id) >= 0;
  var playing = state.movie && state.movie.live && state.movie.channel.id === ch.id && els.player.classList.contains('show');
  var off = LIVE_STATUS[ch.id] === false;
  return '<div class="ch-card ' + (playing ? 'on' : '') + (off ? ' off' : '') + '" data-act="live-play" data-id="' + esc(ch.id) +
    '" tabindex="0" role="button" aria-label="播放直播频道 ' + esc(ch.name) + '">' +
    '<div class="ch-top">' +
      '<div class="ch-logo" style="background:' + esc(ch.color) + '">' + esc(ch.logo) + '</div>' +
      '<div class="ch-meta"><div class="ch-name">' + esc(ch.name) +
        (off ? '<span class="off-badge">暂不可播</span>' : '<span class="live-dot">LIVE</span>') +
        '<span class="net-badge">网络直播</span></div>' +
        '<div class="ch-sub">CH ' + String(ch.no).padStart(2,'0') + ' · ' + esc(ch.group) + '</div></div>' +
      '<button class="ch-fav ' + (fav ? 'on' : '') + '" data-act="live-fav" data-id="' + esc(ch.id) +
        '" title="收藏频道">' + (fav ? '★' : '☆') + '</button>' +
    '</div>' +
    '<div class="ch-epg"><div class="epg-now">正在直播 · <b>' + esc(e.now) + '</b></div>' +
      '<div class="epg-track"><i style="width:' + e.pct.toFixed(1) + '%"></i></div>' +
      '<div class="epg-next">接下来 · ' + esc(e.next) + '</div></div>' +
      '<div class="ch-sub" style="margin-top:6px">' + (function(){
        var n = (ch.sources || []).length;
        var bk = (getStore('kh_live_backup', {}) || {})[ch.id] || [];
        if(bk.length) return '共 ' + n + ' 条线路 · 另有你添加的 ' + bk.length + ' 条备用';
        return n <= 1 ? '仅 1 条线路 · 建议在下方加一条备用' : '共 ' + n + ' 条线路';
      })() + '</div>' +
  '</div>';
}
function renderLiveView(){
  var list = filteredLive();
  var all = allLiveChannels();
  var mine = getLive();
  var favMap = {};
  var favArr = getLiveFav();
  for(var fvi=0;fvi<favArr.length;fvi++) favMap[favArr[fvi]] = true;
  var d = new Date();
  var pad = function(n){ return (n < 10 ? '0' : '') + n; };
  var week = ['日','一','二','三','四','五','六'][d.getDay()];
  var h = '<div class="live-hero"><div class="live-hero-in">' +
    '<div class="lh-tag">LIVE TV · 电视直播</div>' +
    '<h1>打开就播，像看电视一样换台</h1>' +
    '<p><b>内置 ' + LIVE_CHANNELS.length + ' 个频道，全部线路逐条实测可播（共 ' + khSrcCount() + ' 条线路，' + khMultiCount() + ' 个频道带备用线路）</b>：' +
      '央视频道、卫视、中国港澳台地区与城市频道，点开即播；主源卡住自动切备用，仍失败会标记失效并回传中枢。</p>' +
      (LIVE_MISSING.length ? '<p style="margin-top:6px;color:#9AA6C4">另有 ' + LIVE_MISSING.length + ' 个频道当前没有可用公开线路，已暂时下线，不再在「全部」里占位；下方「待补源」可查看名单。</p>' : '') +
    '<div class="live-stats"><span><b>' + all.length + '</b>个频道</span>' +
      '<span><b>' + LIVE_CHANNELS.length + '</b>个预置</span>' +
      '<span><b>' + LIVE_CHANNELS.filter(function(c){return c.net;}).length + '</b>路网络直播</span>' +
      '<span><b>' + mine.length + '</b>个自建</span>' +
      '<span><b>' + getLiveFav().length + '</b>个收藏</span>' + '<span><b>' + Object.keys(LIVE_STATUS).filter(function(k){return LIVE_STATUS[k];}).length + '</b>个当前可播</span></div>' +
    '</div><div class="live-clock"><div class="t" id="heroClock">' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
    '</div><div class="d">' + (d.getMonth()+1) + ' 月 ' + d.getDate() + ' 日 · 星期' + week + '</div></div></div>';

  h += '<div class="live-searchbox" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
    '<span style="font-size:12px;color:#9AA6C4;flex:1;min-width:210px">🔄 自动检测已开启 · ' +
      esc(sourceStatusLine()) + ' · ' + esc(khDeviceLine()) + '</span>' +
    '<button class="qbtn" data-act="src-update">⟳ 立即更新源清单</button>' +
    '<button class="qbtn" data-act="src-health-reset">重置健康记录</button></div>';
  h += '<div class="live-searchbox"><span>🔍</span>' +
    '<input id="liveSearch" type="text" placeholder="搜频道名 / 分组，' + LIVE_CHANNELS.length + ' 个频道随时找到" autocomplete="off" aria-label="搜索直播频道">' +
    (state.liveKeyword ? '<button class="qbtn" data-act="live-search-clear">清空</button>' : '') +
    '</div>';
  h += '<div class="section-head"><h2>频道列表</h2><span>共 ' + list.length + ' 个 · 点击卡片直接播放</span></div><div class="chips">';
  var grps = ['全部'].concat(khLiveGroups());
  for(var g=0;g<grps.length;g++){
    var gp = grps[g];
    h += '<button class="chip ' + (state.liveGroup === gp ? 'on' : '') +
         '" data-act="live-group" data-group="' + esc(gp) + '">' + esc(gp) + '</button>';
  }
  h += '</div>';
  if(list.length){
    h += '<div class="live-grid">';
    for(var i=0;i<list.length;i++) h += liveCard(list[i], favMap);
    h += '</div>';
  } else {
    h += '<div class="empty"><span class="ico">📺</span>这个分组还没有频道<br>点「我添加的」自建，或先在下面添加直播源</div>';
  }

  if(LIVE_MISSING.length){
    h += '<div class="section-head"><h2>待补源频道</h2><span>' + LIVE_MISSING.length + ' 个 · 公开线路当前失效，暂不上架</span></div>' +
      '<div class="sitebox"><h3>这些频道需要可用线路才能恢复</h3>' +
      '<p>已按频道逐条实测，下面这些频道目前没有任何一条公开直播线路能出片，因此从「全部」里下线，避免点开是黑屏。' +
      '找到可用线路时，用下方「自己添加直播源」填同名频道即可自动归位；也可以在设置页同步中枢下发的新源清单。</p>' +
      '<div class="chips">' + LIVE_MISSING.map(function(n){ return '<span class="chip" style="cursor:default;opacity:.75">' + esc(n) + '</span>'; }).join('') + '</div></div>';
  }
  h += '<div class="section-head"><h2>添加直播频道</h2><span>自建 ' + mine.length + ' / 50 · 支持 M3U 播放列表批量导入</span></div>' +
    '<div class="sitebox"><h3>' + (state.liveEdit >= 0 ? '编辑直播源' : '自己添加直播源') + '</h3>' +
    '<p>填频道名称与 m3u8 / mp4 直链即可保存。仅放行 http(s) 地址；m3u8 走 HLS 播放器，' +
      '主源失败自动切备用源。请只添加你拥有合法授权的直播信号。</p>' +
    '<div class="siteform live-form">' +
      '<input id="liveName" class="n" type="text" placeholder="频道名称，如：我的电视" autocomplete="off" maxlength="20">' +
      '<input id="liveUrl" class="u" type="text" placeholder="https://example.com/live.m3u8" autocomplete="off">' +
      '<input id="liveGroupInput" class="n g" type="text" placeholder="分组（可选，默认「我添加的」）" autocomplete="off" maxlength="12">' +
      '<button class="btn-primary" data-act="live-add">' + (state.liveEdit >= 0 ? '✓ 保存' : '＋ 添加') + '</button>' +
      (state.liveEdit >= 0 ? '<button class="btn-ghost" data-act="live-cancel">取消</button>' : '') +
    '</div>' +
    '<div class="sitetools">' +
      '<button class="qbtn" data-act="live-fill">填入示例</button>' +
      '<button class="qbtn" data-act="live-export">导出 M3U</button>' +
      '<button class="qbtn" data-act="live-import">导入 M3U</button>' +
      '<button class="qbtn" data-act="live-clear">清空自建</button>' +
    '</div>' +
    '<div class="backupbox"><textarea id="liveBackup" placeholder="点「导出 M3U」生成播放列表；也可粘贴 #EXTM3U 文本后点「导入 M3U」批量添加" aria-label="直播源 M3U 数据"></textarea></div>' +
    '<div class="pastebox" style="margin-top:12px;border-top:1px dashed rgba(255,255,255,.18);padding-top:10px">' +
      '<p style="margin:0 0 6px;font-size:13px;line-height:1.5"><strong>给内置频道加一条备用线路</strong>（仅本机保存；主源挂了会自动切到它）：</p>' +
      '<div class="siteform">' +
        '<select id="liveBackupCh" aria-label="选择频道">' + allLiveChannels().map(function(c){ return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
        '<input id="liveBackupUrl" class="u" type="text" placeholder="https://example.com/backup.m3u8" aria-label="备用线路地址">' +
        '<button class="btn-primary" data-act="live-backup-add">＋ 加备用</button>' +
      '</div></div>' +
    (state.liveConfirmClear ? '<div class="confirmbar">确定清空全部 ' + mine.length + ' 个自建频道？此操作不可撤销。' +
      '<button class="btn-primary" data-act="live-clear-yes">确定清空</button>' +
      '<button class="btn-ghost" data-act="live-clear-no">再想想</button></div>' : '') +
    '</div>';

  if(mine.length){
    h += '<div class="section-head"><h2>我添加的</h2><span>' + mine.length + ' 个 · 可编辑 / 排序 / 删除</span></div><div class="sitelist">';
    for(var k=0;k<mine.length;k++){
      var s = mine[k];
      h += '<div class="siteitem"><div class="siteico" style="background:#3B456B">' +
        esc((s.name || '自').slice(0,1)) + '</div>' +
        '<div class="sitemeta"><div class="n">' + esc(s.name) + '</div><div class="u">' + esc(s.url) + '</div></div>' +
        '<button class="mini" data-act="live-up" data-index="' + k + '" title="上移">↑</button>' +
        '<button class="mini" data-act="live-edit" data-index="' + k + '" title="编辑">✎</button>' +
        '<button class="siteopen" data-act="live-open" data-index="' + k + '">播放</button>' +
        '<button class="sitedel" data-act="live-del" data-index="' + k + '" title="删除">✕</button></div>';
    }
    h += '</div>';
  }

  h += '<div class="live-note">直播说明：全部频道直连 <b>iptv-org 社区收录的公开免费频道</b>与公开测试流' +
    '（含 CCTV / CGTN / ARD / 4Fun / Al Arabiya 等实测可播源），每个频道都配了 3 路可自动切换的线路，卡住 6.5 秒自动换线。' +
    '第三方直播流能否实时播放仍受对方服务器、地域与授权限制：浏览器安全模型要求源带 CORS，' +
    '未带 CORS 的源会被拦截，此时会自动切下一路，不会黑屏转圈。' +
    '要观看指定授权信号，请在「添加直播频道」填入自有源，或用 M3U 导入。</div>';
  h += '<div class="tip">播放器快捷键：<kbd>空格</kbd>播放/暂停　<kbd>↑</kbd><kbd>↓</kbd>上一台 / 下一台　' +
    '<kbd>M</kbd>静音　<kbd>F</kbd>全屏　<kbd>Esc</kbd>返回频道列表。直播态隐藏进度条与倍速（直播不可拖进度）。</div>';
  return h;
}

/* 起播源选择：一律从网络直播主源（index 0）开始，点开即播真实网络直播。
   主源卡住/失败由看门狗与 nextSource 自动切备用源，不再默认播放本地画面。
   显式指定 startIndex 的自检入口（live / livehls / liveonline）不受影响。 */
function startLiveIndex(ch){
  return 0;
}
function openLiveChannel(ch, startIndex){
  if(!ch) return;
  state.liveList = filteredLive();
  var idx = -1;
  for(var i=0;i<state.liveList.length;i++){ if(state.liveList[i].id === ch.id){ idx = i; break; } }
  state.liveIndex = idx;
  openPlayer(liveMovieObj(ch), startIndex === undefined ? startLiveIndex(ch) : startIndex);
}
function switchLive(delta){
  if(!state.movie || !state.movie.live) return;
  var list = state.liveList && state.liveList.length ? state.liveList : allLiveChannels();
  var n = list.length;
  if(!n) return;
  var i = (state.liveIndex + delta + n * 2) % n;
  state.liveIndex = i;
  openPlayer(liveMovieObj(list[i]), startLiveIndex(list[i]));
  toast('CH ' + String(list[i].no).padStart(2,'0') + ' · ' + list[i].name);
}
function updateLiveBar(ch){
  if(!ch) return;
  var e = epgFor(ch, new Date());
  els.lbCh.textContent = 'CH ' + String(ch.no).padStart(2,'0') + ' · ' + ch.name;
  els.lbEpg.textContent = '正在直播：' + e.now + '　｜　接下来：' + e.next;
  var fav = getLiveFav().indexOf(ch.id) >= 0;
  els.lbFav.textContent = fav ? '★ 已收藏' : '☆ 收藏';
  els.lbFav.classList.toggle('on', fav);
}
function toggleLiveFav(id){
  if(!id) return;
  var f = getLiveFav(), i = f.indexOf(id);
  if(i >= 0){ f.splice(i,1); toast('已取消收藏频道'); } else { f.unshift(id); toast('已收藏频道'); }
  setStore('kh_livefav', f.slice(0,50));
  if(state.movie && state.movie.live) updateLiveBar(state.movie.channel);
  render();
}
function addLive(){
  var nEl = document.getElementById('liveName'), uEl = document.getElementById('liveUrl'), gEl = document.getElementById('liveGroupInput');
  if(!nEl || !uEl) return;
  var name = nEl.value.trim(), url = normalizeStreamUrl(uEl.value);
  var group = gEl ? gEl.value.trim().slice(0,12) : '';
  if(!name){ toast('请填频道名称'); return; }
  if(!url){ toast('请填合法的 http(s) 直播地址'); return; }
  var list = getLive();
  for(var i=0;i<list.length;i++){
    if(i !== state.liveEdit && list[i].url === url){ toast('这个直播地址已经在列表里了'); return; }
  }
  var item = {name:name.slice(0,20), url:url, group:group || '我添加的'};
  if(state.liveEdit >= 0 && state.liveEdit < list.length){
    list[state.liveEdit] = item; toast('已保存修改');
  } else {
    list.unshift(item); toast('已添加：' + name);
  }
  setStore('kh_live', list.slice(0,50));
  state.liveEdit = -1;
  render();
}
function delLive(index){
  var list = getLive();
  if(isNaN(index) || index < 0 || index >= list.length) return;
  var removed = list[index], at = index;
  list.splice(index,1);
  setStore('kh_live', list);
  if(state.liveEdit === at) state.liveEdit = -1;
  toast('已删除「' + removed.name + '」', '撤销', function(){
    var cur = getLive(); cur.splice(Math.min(at, cur.length), 0, removed);
    setStore('kh_live', cur.slice(0,50)); toast('已恢复「' + removed.name + '」'); render();
  });
  render();
}
function startEditLive(index){
  var list = getLive();
  if(index < 0 || index >= list.length) return;
  state.liveEdit = index; render();
  var s = list[index];
  var n = document.getElementById('liveName'), u = document.getElementById('liveUrl'), g = document.getElementById('liveGroupInput');
  if(n) n.value = s.name;
  if(u) u.value = s.url;
  if(g) g.value = s.group || '';
  if(n) n.focus();
  els.main.scrollTop = 0;
}
function moveUpLive(index){
  var list = getLive();
  if(index <= 0 || index >= list.length) return;
  var t = list[index]; list[index] = list[index-1]; list[index-1] = t;
  setStore('kh_live', list);
  if(state.liveEdit === index) state.liveEdit = index - 1;
  else if(state.liveEdit === index - 1) state.liveEdit = index;
  render();
}
function exportLiveM3u(){
  var ta = document.getElementById('liveBackup'); if(!ta) return;
  var list = getLive(), text = '#EXTM3U\n';
  for(var i=0;i<list.length;i++){
    var s = list[i];
    text += '#EXTINF:-1 tvg-name="' + s.name.replace(/"/g,'') + '" group-title="' +
            (s.group || '我添加的').replace(/"/g,'') + '",' + s.name + '\n' + s.url + '\n';
  }
  ta.value = text; ta.focus(); ta.select();
  try{ if(navigator.clipboard) navigator.clipboard.writeText(text).catch(function(){}); }catch(e){}
  toast('已导出 ' + list.length + ' 个频道的 M3U，可复制备份');
}
function parseM3u(text){
  var lines = String(text).split(/\r?\n/), out = [], pend = null;
  for(var i=0;i<lines.length;i++){
    var ln = lines[i].trim();
    if(!ln) continue;
    if(/^#EXTINF/i.test(ln)){
      var g = /group-title="([^"]*)"/i.exec(ln);
      var n = /tvg-name="([^"]*)"/i.exec(ln);
      var c = ln.lastIndexOf(',');
      var nm = c >= 0 ? ln.slice(c+1).trim() : '';
      pend = {name:(n && n[1] ? n[1] : nm).slice(0,20), group:(g && g[1] ? g[1] : '我添加的').slice(0,12)};
      continue;
    }
    if(/^https?:\/\//i.test(ln)){
      var u = normalizeStreamUrl(ln);
      if(u){
        out.push({name:(pend && pend.name) || ('频道 ' + (out.length+1)),
                  group:(pend && pend.group) || '我添加的', url:u});
      }
      pend = null;
    }
  }
  return out;
}
function importLiveM3u(){
  var ta = document.getElementById('liveBackup');
  if(!ta || !ta.value.trim()){ toast('请先粘贴 #EXTM3U 播放列表'); return; }
  var incoming = parseM3u(ta.value);
  if(!incoming.length){ toast('没有解析到有效频道（需 #EXTINF + http(s) 地址）'); return; }
  var list = getLive(), added = 0, seen = {};
  for(var i=0;i<list.length;i++) seen[list[i].url] = true;
  for(var j=0;j<incoming.length && list.length < 50;j++){
    var s = incoming[j];
    if(seen[s.url]) continue;
    seen[s.url] = true;
    list.push({name:s.name, url:s.url, group:s.group}); added++;
  }
  setStore('kh_live', list);
  toast('导入完成，新增 ' + added + ' 个频道');
  render();
}
function clearLive(yes){
  if(!yes){ state.liveConfirmClear = true; render(); return; }
  setStore('kh_live', []);
  state.liveConfirmClear = false; state.liveEdit = -1;
  toast('已清空全部自建频道'); render();
}
function liveAction(act, node){
  var idx;
  if(act === 'live-search-clear'){
    state.liveKeyword = ''; state.liveSearchFocus = false; render();
  } else if(act === 'live-play'){
    var id = node.getAttribute('data-id');
    var all = filteredLive();
    for(var i=0;i<all.length;i++){ if(all[i].id === id){
      if(LIVE_STATUS[id] === false){ toast('「' + all[i].name + '」当前线路暂不可播，可稍后重试或在问题页反馈待补源'); return; }
      openLiveChannel(all[i]); return; } }
  } else if(act === 'live-fav'){
    toggleLiveFav(node.getAttribute('data-id'));
  } else if(act === 'live-group'){
    state.liveGroup = node.getAttribute('data-group'); render();
  } else if(act === 'live-add'){
    addLive();
  } else if(act === 'live-cancel'){
    state.liveEdit = -1; render();
  } else if(act === 'live-edit'){
    startEditLive(parseInt(node.getAttribute('data-index'), 10));
  } else if(act === 'live-up'){
    moveUpLive(parseInt(node.getAttribute('data-index'), 10));
  } else if(act === 'live-del'){
    delLive(parseInt(node.getAttribute('data-index'), 10));
  } else if(act === 'live-open'){
    idx = parseInt(node.getAttribute('data-index'), 10);
    state.liveGroup = '我添加的';
    var chs = filteredLive();
    if(!isNaN(idx) && chs[idx]) openLiveChannel(chs[idx]);
  } else if(act === 'live-fill'){
    var n = document.getElementById('liveName'), u = document.getElementById('liveUrl'), g = document.getElementById('liveGroupInput');
    if(n) n.value = '我的直播频道';
    if(u) u.value = 'https://你的直播源.m3u8';
    if(g) g.value = '我添加的';
    toast('已填入占位示例，替换成你自己的直播源即可');
  } else if(act === 'live-export'){
    exportLiveM3u();
  } else if(act === 'live-import'){
    importLiveM3u();
  } else if(act === 'live-clear'){
    clearLive(false);
  } else if(act === 'live-clear-yes'){
    clearLive(true);
  } else if(act === 'live-clear-no'){
    state.liveConfirmClear = false; render();
  }
}

var RATES = [0.75, 1, 1.25, 1.5, 2];
var SAMPLE_STREAMS = [];



/* ---------------- 启动补发（1.7.85 优化） ----------------
   上次上报失败留下 pending 水位时，启动 8 秒后重试一次；无待发会自动跳过。
   客户纯净版默认不在 enabled，只有用户显式开启才会走到这里。 */
try{
  if(getStore('kh_issue_pending_v1', null) && issueRemoteCfg().enabled){
    setTimeout(function(){ issueRemoteSend(false); }, 8000);
  }
}catch(e){}

/* ---------------- 商店纯净变体（1.7.108）：清空一切预置内容 ----------------
   本块在 kh-config.js 末尾执行（早于 kh-core / kh-app），把硬编码的预置平台、
   直播频道、内置种子、搜索模板、快捷入口全部清空。配合各 apply / seed / getWhList
   的 KH_STORE 闸，商店包内不残留任何在线内容入口。私发版不注入旗标，不受影响。 */
if(window.KH_STORE){
  try{
    BUILTIN_SITES = [];
    LIVE_CHANNELS = [];
    SEED_SITES = [];
    SEED_WH_APIS = [];
    SEARCH_TPL = {};
    window.KH_QUICK = {};
    window.__KID_ALL_LIVE = [];
  }catch(e){}
}
