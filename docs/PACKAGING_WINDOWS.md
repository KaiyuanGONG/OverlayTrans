# Windows 打包指南

本文说明如何从干净仓库生成 OverlayTrans 的 Windows MSI 与 NSIS（`.exe`）安装包。

## 1. 准备环境

需要：

- Node.js 与 npm；
- Rust stable MSVC toolchain；
- Visual Studio Build Tools（Desktop development with C++）；
- 可访问 GitHub 的网络。Tauri 会自动准备 WiX/NSIS，sidecar 脚本会下载锁定的 llama.cpp 源码。
- 精确版本 `cargo-about 0.8.4` 与 `cargo-deny 0.20.2`，用于许可证发布门禁。
- 本地模式要求 AVX2 兼容 CPU，并同时支持 FMA、F16C 与 BMI2；在线速度/质量模式不受此限制。

在仓库根目录安装前端依赖：

```powershell
npm.cmd ci
```

安装并验证固定许可证工具版本：

```powershell
cargo install --locked --version 0.8.4 cargo-about
cargo install --locked --version 0.20.2 cargo-deny
cargo about --version
cargo deny --version
```

版本输出必须分别为 `cargo-about 0.8.4` 和 `cargo-deny 0.20.2`。

## 2. 准备固定版本 sidecar

必须在仓库根目录运行：

```powershell
node scripts/prepare-sidecar.mjs
```

脚本会：

1. 下载并校验 llama.cpp `b10068` 固定 revision 的源码 zip；
2. 用 Windows 自带的 `tar.exe` 解压，并校验源码中的原始 LICENSE；
3. 检测构建主机支持 AVX2；
4. 用 Visual Studio 2022 x64 Release、静态 MSVC CRT、`GGML_OPENMP=OFF`、`GGML_BMI2=ON` 构建 `llama-server`；
5. 运行 `--version` 并用 `dumpbin /dependents` 校验固定 PE 依赖白名单；
6. 把可执行文件按 Tauri external binary 规则命名为 `llama-server-x86_64-pc-windows-msvc.exe`；
7. 仅在全部检查通过后事务性替换 `src-tauri/binaries/`，其中只保留静态 EXE 与 `llama-server-LICENSE.txt`。激活失败会恢复先前可用目录。

验证 runtime：

```powershell
& .\src-tauri\binaries\llama-server-x86_64-pc-windows-msvc.exe --version
```

预期版本为 `10068 (571d0d540...)`，且 PE 依赖中不得出现 `libomp`。`src-tauri/binaries/` 是构建产物，已被 Git 忽略，不应提交。

## 3. 先跑代码门禁

Rust：

```powershell
Set-Location src-tauri
cargo fmt --all -- --check
cargo build --locked
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
Set-Location ..
```

前端与 diff：

```powershell
npm.cmd run test
npm.cmd run build
npm.cmd run licenses:check
git diff --check
```

`licenses:check` 会把 Rust 与前端许可证报告重新生成到临时目录，再与仓库中的正文逐字节比较，不会覆盖仓库文件。更新依赖后需要主动刷新报告：

```powershell
npm.cmd run licenses:generate
```

在干净的发布工作树运行完整许可证门禁：

```powershell
npm.cmd run licenses:gate
```

该命令最后执行 `git status --porcelain=v1 --untracked-files=all`。任何 staged、unstaged 或 untracked 文件都会使门禁失败。

不要并行运行 Vitest 与 Vite build；共享 Vite/Rollup 状态时可能产生无意义的入口冲突。

## 4. 生成安装包

在仓库根目录执行：

```powershell
npm.cmd run tauri build
```

完整构建依次执行：

1. `beforeBuildCommand`：TypeScript + Vite；
2. Rust release build；
3. 将 external binary 的 target triple 输入名转换为安装目录中的 `llama-server.exe`；
4. 将 llama.cpp 原始许可证、`THIRD_PARTY_NOTICES.md` 以及 Rust/前端完整许可证报告作为 resources 打包；
5. WiX 生成 MSI；
6. NSIS 生成 `.exe` 安装器。

首次 release build 可能需要 5–10 分钟。输出位置：

```text
src-tauri/target/release/bundle/msi/OverlayTrans_<version>_x64_en-US.msi
src-tauri/target/release/bundle/nsis/OverlayTrans_<version>_x64-setup.exe
```

如果 release EXE 已经是当前源码构建的，只想重新生成安装器，可以使用：

```powershell
npx.cmd tauri bundle --bundles msi,nsis
```

这不能代替发布前最后一次完整 `tauri build`。

## 5. 安装包 smoke

优先用 NSIS 安装器做普通用户路径测试：

1. 安装并启动应用，确认新 Chameleon 图标出现在 EXE、任务栏和托盘；
2. 连续启动两次 OverlayTrans，确认只有一个进程，第二次启动只唤醒已有窗口：

```powershell
(Get-Process overlay-trans -ErrorAction SilentlyContinue).Count
```

3. 启动本地 runtime，确认 `llama-server` 没有可见控制台窗口：

```powershell
Get-Process llama-server -ErrorAction SilentlyContinue |
  Select-Object ProcessName, Id, MainWindowHandle
```

`MainWindowHandle` 应为 `0`。

4. 测试托盘显示/隐藏、设置窗口、F8 翻译和退出后 sidecar 清理；
5. 再执行一次真实 Local 翻译，确认安装目录中的 LICENSE 与静态 sidecar 可用，并确认没有 `libomp140.x86_64.dll`。

可选：不安装 MSI，只行政解包检查内容：

```powershell
$msi = Get-ChildItem .\src-tauri\target\release\bundle\msi\OverlayTrans_*.msi |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $msi) { throw "未找到 MSI，请先执行 npm.cmd run tauri build" }
$dest = Join-Path (Resolve-Path .\src-tauri\target) package-audit
New-Item -ItemType Directory -Force $dest | Out-Null
Start-Process msiexec.exe -ArgumentList @('/a', "`"$($msi.FullName)`"", '/qn', "TARGETDIR=`"$dest`"") -Wait
```

## 6. 常见问题

- `prepare-sidecar.mjs` 找不到：你在 `src-tauri` 目录；先 `Set-Location ..`。
- WiX 报 Windows Installer service 不可访问：检查 `Get-Service msiserver`，必要时在普通本机终端重新执行，不要在受限沙箱运行 ICE。
- 安装器文件被占用：退出已安装应用并关闭资源管理器预览，再重新打包。
- `identifier` 以 `.app` 结尾的提示是 macOS 命名建议；Windows 包仍可生成。发布后不要随意更改 identifier，否则会影响升级身份。
- 正式发布前应同步更新 `package.json`、`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 的版本号，并配置代码签名；未签名安装器可能触发 SmartScreen。
- 重新生成图标必须走项目的完整 no-hex 流程；不要直接运行 `tauri icon`，否则会绕过小尺寸 compact 图标、ICO 多帧和鼻尾完整性门禁：

```powershell
node scripts/generate-icons.mjs
node scripts/generate-installer-assets.mjs
node scripts/validate-brand-assets.mjs
```
