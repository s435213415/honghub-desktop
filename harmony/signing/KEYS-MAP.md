# 签名密钥地图（鸿汇影）

> 一份表格说清「哪套密钥、签哪个包、什么类型、什么时候过期、私钥在谁手里」。
> 口令一律不落盘到本目录，只从工程根 `.env` 或环境变量读取。

## 三条链

| 链标识（chain tag） | 密钥 & 证书 | 签的是哪个包 | 类型 | 私钥归属 | 有效期 | 用途 |
|---|---|---|---|---|---|---|
| `kaihong-platform-debug` | `keys-kaihong/kaihong.p12`（别名 `kaihong`）+ `app.cer` + `app.p7b` | **com.kaihong.movie**（开鸿影视设备端） | debug | **自己的**（CSR 由本机生成，平台只签发证书） | 2026-11-19 ~ 2027-11-19 | 真机安装调试、自持私钥装机 |
| `kaihong-platform-release` | `keys-kaihong/kaihong.p12`（暂复用）+ `app-release.cer`（**待补**）+ `profile-release.p7b` | **com.kaihong.movie**（开鸿影视设备端正式分发） | release | **自己的** | Profile 至 2043-09-09；应用证书待平台签发 | 正式版 / 上架；**材料未齐，暂不可出包** |
| `official-openharmony` | SDK `OpenHarmony.p12`（别名 `openharmony application release`）+ `keys-official/profile-release.p7b` | **com.honghub.harmony**（鸿汇影主体 HAP） | release | **不是自己的**：OpenHarmony SDK 公开密钥，口令公开 `123456` | profile 长期 | 桌面端内置 HAP、免 UDID 安装 |
| `legacy-self-ca`（已停用） | `keys/sign-keys/app-key.p12`、`profile-key.p12`、`ca.p12` | 旧版自签包 | 自签 | 自己的 | — | 仅历史包，新包不再使用 |

## 关键约束

1. **Profile 的 `bundle-name` 必须与包内 `module.json` 的 `bundleName` 完全一致**，否则签名能过、装机必失败。
   - 主体 HAP 是 `com.honghub.harmony`，而平台签发的调试 Profile 是 `com.kaihong.movie` → **两者不能互换**。
2. **证书类型与 Profile 类型必须一致**（debug 证书配 debug Profile，release 证书配 release Profile），混用装不上。
3. 要发布 `release` 版（正式分发），必须在 developer.kaihong.com 用**同一把私钥对应的 CSR 重新申请 release 证书 + release Profile**；现有调试证书只能本地装。
4. `kaihong-platform-release` 当前材料状态（2026-11-19）：`profile-release.p7b`（release Profile，bundle=com.kaihong.movie，type=release，有效期至 2043-09-09）已归档；`kaihong-release.csr` 已用同一把自持私钥生成（DN OU=Release，公钥与 `kaihong.p12` 同源），供平台上传申请；**`app-release.cer`（release 应用证书链）仍待平台签发**，私钥暂复用 `kaihong.p12`。若平台为 release 另发了私钥，需连同新 `.p12` 一起替换；缺 `app-release.cer` 时该链自检不过、不会出包。

## 口令存放

| 需要哪个口令 | 变量名 | 位置 |
|---|---|---|
| 自持私钥 `kaihong.p12` 的库/密钥口令 | `KH_KAIHONG_PWD` | 工程根 `.env`（已被 .gitignore 忽略） |
| SDK 官方 p12 口令 | 固定 `123456`（公开） | 脚本常量 `OFFICIAL_PWD` |

## 副本策略（2026-11-19 收敛后）

- **权威副本**：`harmony/signing/keys-kaihong/`（签名脚本默认读这里）
- **离线备份**：`桌面\鸿汇影·开鸿签名资料\`（只留一份，含材料说明）
- 已删除的重复副本：`Documents\KaihongMovie-签名密钥备份-20261113\`、`桌面\鸿汇影·历史归档\*_v1.7.*\签名密钥\`（删除前已逐文件 sha256 比对一致）

## 变更记录

- 2026-11-19：建立 `keys-kaihong/`，把自持私钥收敛到一处；补齐链校验（bundle 匹配 / profile 类型 / 证书过期）与 `--check` 自检；口令从明文文档迁到 `.env`。
