# oVoice · Windows 本地 AI 语音工作站

> **V1.0.3** · 基于 [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM) 构建的 **Windows x64 桌面 AI 语音工作站**。  
> 支持**声音设计、可控克隆、极致克隆、批量合成、音色资产与模型全生命周期管理**——本地引擎数据不出本机、完全离线可用；亦可在设置中一键切换 **OpenAI 兼容云端 API** 轻量合成。

> 上游 VoxCPM 原始文档见 [`README.md`](./README.md) / [`README_zh.md`](./README_zh.md)；本仓库核心代码分布在 `backend/`、`apps/desktop/`、`scripts/ovoice/`、`website/` 与推理适配层 `src/voxcpm/`。

---

## 系统架构

```
┌──────────────────────────────────────────────────────────────────────┐
│  Desktop UI  ·  Tauri 2 + React 19 + TypeScript + Tailwind 4         │
│  语音创作 / 音色库 / 批量任务 / 历史记录 / 模型管理 / 设置 / 离线激活    │
└───────────────────────────────┬──────────────────────────────────────┘
              127.0.0.1 随机端口 + 启动期随机令牌 (HTTP + SSE)
┌───────────────────────────────┴──────────────────────────────────────┐
│  Application Services  ·  Python 3.11 + FastAPI + SQLAlchemy/SQLite  │
│  TTS 队列 · 分阶段资源调度 · 模型缓存 · 音色试听 · 历史管理 · 离线验签   │
└───────────────────────────────┬──────────────────────────────────────┘
┌───────────────────────────────┴──────────────────────────────────────┐
│  Dual Inference Provider                                             │
│  1) 本地引擎: VoxCPM2 / 1.5 / 0.5B + SenseVoice ASR + ZipEnhancer     │
│  2) 云端 API: OpenAI 兼容语音合成接口（零本地权重、无需独立显卡）        │
│  3) 开发引擎: MockEngine（无模型权重全流程调试）                        │
└───────────────────────────────┬──────────────────────────────────────┘
              本地存储  SQLite · 音频 · 音色 · 模型缓存 · 日志
```

---

## 核心功能一览

| 模块 | 说明 |
| --- | --- |
| **语音创作工作台** | 统一支持**声音设计 / 可控克隆 / 极致克隆**三模式，参数面板、种子复现、SSE 实时进度与 WaveSurfer 波形试听 |
| **双引擎切换** | 「设置 → AI Provider」可在**本地 VoxCPM 引擎**与 **OpenAI 兼容云端 API** 间自由切换（API 模式为纯语音合成，不支持克隆或自动转写） |
| **音色资产库** | 上传/历史导入、标签与分类检索、自动转写；保留完整克隆用参考音频，并独立生成最长 5 秒的 `preview.wav` 试听文件 |
| **批量合成队列** | 长文本按空行 / 行 / 句切分、顺序队列执行、失败项一键重试、原子写入 ZIP 打包导出 |
| **历史记录与原生导出** | SQL 筛选分页、多选批量删除（数据库异常自动回滚暂存文件）、系统原生保存弹窗与孤立音频恢复 |
| **模型与显存管理** | VoxCPM2 / 1.5 / 0.5B 及辅助模型（SenseVoiceSmall / ZipEnhancer）手动下载与本地导入；选择模型不预占显存，任务结束默认立即释放显存并支持自动恢复 |
| **分阶段资源调度** | 按实时 CPU / 内存 / 显存预算分配阶段设备；支持**桌面流畅优先**与**生成速度优先**两种策略，不以裁剪音频或降低采样质量换取速度 |
| **离线永久授权（V1.x）** | 基于 Ed25519 的单机离线激活（机器码 `OVMC1-…` → 激活码 `OV1.…`），安装包仅内置验签公钥，全程不联网验签 |
| **静态官网与部署包** | `website/` 提供与桌面端统一的暗色响应式静态官网（320px–2560px，含实时声波/VU 动效与 SHA-256 校验），可一键打包部署至宝塔 Nginx 或 GitHub Pages |

### 三种本地生成模式

| 模式 | 输入 | 提示构造 |
| --- | --- | --- |
| **声音设计** | 目标文本 + 音色描述（性别/年龄/情绪/语速/方言） | `(控制描述)目标文本`，无需参考音频（需 VoxCPM2） |
| **可控克隆** | 参考音频 + 可选风格控制指令 | `(控制描述)目标文本` + `reference_wav_path` |
| **极致克隆** | 参考音频 + 转写文本（可由 SenseVoiceSmall 自动识别） | `prompt_wav_path` + `prompt_text`（控制指令禁用） |

---

## V1.0.3 性能与工程亮点

V1.0.3 对冷加载、自回归推理循环、连续/批量克隆缓存及后端调度进行了系统性优化（均不改变模型精度、采样参数或输出音质）：

- **冷加载提速（`meta` 骨架 + `assign=True`）**：跳过约 2B `bfloat16` 参数在 CPU 上的无效随机初始化，`AudioVAE` 保持 FP32 直载。
- **参考音频特征缓存**：对相同参考音频的降噪与 VAE 编码特征在 CPU 侧做有界 LRU 缓存（上限 8 条、按路径与文件元信息自动失效、零 GPU 显存占用），连续与批量克隆自动复用。
- **推理算子与循环优化**：启用 PyTorch 融合 `F.rms_norm`、内联 RoPE 旋转、eager 模式按实际 KV 长度切片跳过 8192 全槽 mask、预分配 `UnifiedCFM.solve_euler` 缓冲区、缓存 `SinusoidalPosEmb` 频率表。
- **后端轻量化**：`resource_snapshot` 改为非阻塞窗口采样、`resource_profiles.json` 增加元信息缓存、历史记录与音色过滤下推至 SQLite SQL、`hardware_snapshot` 消除重复 CUDA 探测。

### RTX 3060 12GB 实测样本（`balanced` 偏好 · VoxCPM2 48kHz · 3 连续排队请求）

| 指标 | 优化前基线 | V1.0.3 实测 | 变化 |
| --- | ---: | ---: | ---: |
| `model_load` 冷加载阶段 | `20.11s` | **`1.41s`** | **14.2× 提速** |
| 后续 2 个排队请求合计 | `13.26s` | **`6.95s`** | **1.91× 提速** |
| 连续吞吐（音频秒 / 墙钟秒） | `0.3619` | **`0.6911`** | **+91.0%** |
| 连续 `warm_rtf` | `2.7633` | **`1.4470`** | **-47.6%** |
| 峰值显存（`peak_allocated_mb`） | `5867.81 MB` | **`5415.73 MB`** | **-452 MB** |
| 队列结束后显存 / 卸载状态 | `16.25 MB` / 已卸载 | `16.25 MB` / 已卸载 | 保持一致 |

> 复现命令：
> ```powershell
> D:\oVoice\runtime\Scripts\python.exe scripts\ovoice\benchmark_resources.py `
>   --models-dir D:\oVoice\data\models --output-dir data\bench-recheck --label recheck --runs 3
> ```

---

## 目录结构

```text
oVoice/
├── backend/                        # FastAPI 应用层后端
│   ├── api/routes/                 # system / models / tts / voices / history / batch
│   ├── core/                       # config · lifecycle · licensing · resources · model_cache · logging
│   ├── database/                   # SQLAlchemy 模型（voices / generations / batch_jobs）
│   ├── docs/使用须知.html           # 随安装包分发的离线使用须知
│   ├── inference/                  # TTSEngine 抽象 · VoxCPM / OpenAI 兼容 / Mock 引擎
│   ├── services/                   # tts · voices · history · batch · model_manager · hardware · audio
│   └── main.py                     # 后端入口（--engine auto|mock --host --port --token --data-dir）
├── apps/desktop/                   # Tauri 2 + React 19 桌面应用
│   ├── src/                        # pages / components / services / stores / styles
│   └── src-tauri/                  # Rust 桌面壳：窗口、运行时缓存指纹、后端托管、原生导出、离线验签
├── src/voxcpm/                     # VoxCPM 推理库（含阶段回调、meta 快速加载与算子优化）
├── scripts/ovoice/                 # bootstrap.ps1 · dev.ps1 · build.ps1 · benchmark_resources.py · validate_*.py
├── tests/                          # Python 单元测试与 UI 回归脚本
├── website/                        # 静态官网源码、Playwright 验收脚本（test-site.cjs）与打包脚本（package.py）
├── docs/                           # 使用须知 Markdown 等说明文档
└── OVOICE_README.md                # 本文件
```

---

## 环境要求与快速开始

### 环境要求
- **运行目标**：Windows 10 / 11 x64
- **开发工具**：Python 3.11、Node.js 20+ / pnpm、Rust MSVC 工具链（打包 `.exe` 时需要）
- **本地推理硬件**：建议 NVIDIA GPU ≥ 8GB 显存（VoxCPM2 推荐 12GB+；低显存可选 VoxCPM-0.5B；无独显可使用云端 API 或回退 CPU）

### 1. Mock 开发模式（无需模型权重与 GPU）

```powershell
# 安装轻量后端依赖
pip install -r backend\requirements-web.txt

# 启动后端 Mock 引擎 + Vite 前端（默认 http://localhost:5173）
powershell -ExecutionPolicy Bypass -File scripts\ovoice\dev.ps1 -Mock
```

### 2. 真实引擎模式（Windows + CUDA）

```powershell
# 一键安装 Python 3.11 运行时 + PyTorch CUDA + VoxCPM 依赖
# 可选: -CudaVersion 126（默认）/ 124 / 118；-SkipEngine 仅装轻量依赖
powershell -ExecutionPolicy Bypass -File scripts\ovoice\bootstrap.ps1

# 启动真实引擎开发模式
powershell -ExecutionPolicy Bypass -File scripts\ovoice\dev.ps1
```

带 Tauri 桌面壳联调（需 Rust MSVC）：

```powershell
cd apps\desktop
$env:OVOICE_PYTHON = "D:\oVoice\runtime\Scripts\python.exe"
pnpm tauri dev
```

---

## 打包与发布

### 1. 构建 Windows NSIS 安装包（`.exe`）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ovoice\build.ps1
# 产物: apps\desktop\src-tauri\target\release\bundle\nsis\oVoice_1.0.3_x64-setup.exe
```

安装包采用**分层交付**（体积约 `1.49 MB`），自动打包前端构建产物、`backend/`、`engine/voxcpm/`、使用须知与运行时安装脚本，构建前自动清理 `__pycache__` 字节码；不包含 Python 运行时、模型权重或发行私钥。

### 2. 打包静态官网部署包（`.zip`）

```powershell
# 自动同步最新安装包、生成 SHA256SUMS.txt / release.json、校验白名单链接并打成 zip
python website\package.py
# 产物: website\oVoice-website-v1.0.3.zip（仅含 11 个公开文件，可直接部署到宝塔 Nginx 或 GitHub Pages）
```

---

## 测试与验收

```powershell
# 1. Python 单元测试（74 项：显存生命周期、资源调度、阶段迁移、VAE 设备独立、音频资产、授权、性能优化回归等）
D:\oVoice\runtime\Scripts\python.exe -m unittest `
  tests/test_ovoice_perf_opt.py tests/test_ovoice_memory.py tests/test_ovoice_resources.py `
  tests/test_ovoice_stage_transfer.py tests/test_ovoice_vae_devices.py tests/test_ovoice_assets.py `
  tests/test_ovoice_runtime.py tests/test_ovoice_licensing.py tests/test_timestamps.py

# 2. Rust 桌面壳单元测试（5 项：导出路径边界、运行时指纹缓存、Ed25519 授权验签向量）
cargo test --manifest-path apps\desktop\src-tauri\Cargo.toml

# 3. 官网 Playwright 自动化验收（320px–1440px 布局、模式键盘操作、下载哈希、安全配置、无 JS 降级）
# 需先在本地 18520 端口托管 website/dist
node website\test-site.cjs
```

---

## 后端 API 概览

所有业务接口均绑定 `127.0.0.1` 随机端口；除健康探测外均校验离线授权与启动期会话令牌（Header `X-OVoice-Token`、`Authorization: Bearer ...` 或 `?token=`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/ping` | 存活探测（供 Tauri 握手） |
| `GET` | `/api/system/status` · `/hardware` · `/license` · `/settings` | 引擎状态 / 硬件显存 / 授权状态 / 配置读写 |
| `POST` | `/api/system/release-memory` | 手动卸载模型释放显存 |
| `GET/POST` | `/api/models` · `/download/{id}` · `/select` · `/load` · `/unload` | 模型目录、下载进度与生命周期 |
| `POST` | `/api/tts/upload-reference` · `/transcribe` · `/generate` | 参考音频上传、ASR 转写与提交生成 |
| `GET` | `/api/tts/jobs/{id}` · `/jobs/{id}/events` | 任务快照与 SSE 实时进度流 |
| `CRUD` | `/api/voices` (+`/{id}/audio` `/{id}/preview`) | 音色库、完整参考音频与 5 秒试听 |
| `GET/DELETE` | `/api/history` (+`/delete-selected`) | 生成历史查询、单删与批量删除 |
| `POST` | `/api/batch` (+`/start` `/cancel` `/retry` `/export`) | 批量任务队列控制与 ZIP 导出 |

---

## 安全与合规

- **本机数据边界**：本地推理时参考录音、生成音频、数据库与模型权重全部保存在本地数据目录，不上传至任何外部服务器；使用第三方 API 时请求仅发往用户自行配置的服务地址。
- **本地接口隔离**：后端仅监听回环地址 `127.0.0.1`，配合每次启动随机生成的会话令牌，未携带合法令牌的请求直接返回 `401`。
- **声音克隆合规**：声音克隆仅限用于本人或已获得明确授权的声音；公开发布合成内容时请遵守当地法律法规并进行 AI 生成标识。
- **开源许可**：上游推理引擎 [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM) 采用 Apache-2.0 协议，详见 [`LICENSE`](./LICENSE)。
