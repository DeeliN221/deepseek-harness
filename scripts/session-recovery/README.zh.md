# 会话自动恢复

[English](README.md) | 中文

此 POSIX 单次巡检脚本通过已认证的 `session/prompt` 端点继续符合条件的中断任务。由已有 task-center cron 服务运行，该服务已整合 dsh-cron。脚本不创建计时器或守护进程。

## 运维设置

核心运行时必须包含此改动提供的 `automaticRecovery` 投影和条件提示准入。先部署匹配的核心产物，再启用任务。缺少对应 API 时，巡检拒绝恢复。

将 `scan.py` 复制到持久部署目录。将 `config.example.json` 复制到私有运行目录，并按当前部署填写 origin、凭据文件和状态目录。把原生启动输出的已认证 URL 保存在 `tokenFile` 指定的私有文件中；launcher 只输出 URL，不创建该文件。URL 的 origin 必须匹配配置的本机端点。脚本将其兑换成常规签名认证 cookie。已有 Bearer 认证提供方的部署可以显式设置 `authentication` 为 `bearer`，并让 `tokenFile` 指向其私有 token。凭据不进入 argv，也不写入恢复日志。配置与凭据保留在 Git 之外。

运行 `python3 scan.py --config /path/to/config.json` 执行一次巡检。将 `cron-job.example.json` 的 argv 任务加入已有调度服务的任务列表，并填写实际部署路径。任务默认启用，按 UTC 每分钟运行一次。使用已运行的 task-center cron 服务及其既有任务列表；不要另启 dsh-cron bundle、守护进程或复制其它任务。仅有磁盘文件不会启动调度。NAS 主管负责 profile 激活、最终部署和重启；此改动不修改生产 profile。

## 安全与观测

Host 只在日志仍处于观测切点时接受空重试输入，并通过维护占用排除活跃驱动器。它不记录合成的人工指令。崩溃修复保留已完成的工具结果；已启动工具的结果未知时禁止自动恢复。人工取消即使发生在空闲期，也会持久撤销恢复资格。完成、阻塞、fork、人工取消、审批或问询活动、非活动目标、凭据错误及 HTTP 422 等无效请求均不符合条件。只有结构化 TRANSPORT/TIMEOUT 终结或原生崩溃修复符合条件。重启后的活动目标仍保持解除自动运行状态；恢复不授权修改或重新激活目标。

巡检跳过运行中的会话、待处理审批/登录/问询事件及 subagent。Host 还拒绝存在运行中自有后台任务的会话。符合条件的停滞 inbox 输入通过 `Agent.resumePending()` 恢复，不改变消息，也不追加另一条继续指令；`recovery/queued` 记录唤醒并去重。巡检不凭沉默猜测中断。Host 在准入时再次检查归档归属。新的过期请求若日志切点变化，会在模型执行前被拒绝；已经接受的请求在崩溃后重投时，可在全部资格检查通过后重新驱动仍待处理的 inbox。

内核建议锁串行化共享状态目录的全部巡检，进程退出即释放。每个目标 origin 使用一个共享状态目录，保存在支持 flock 与原子重命名的本机 POSIX 文件系统。Host 的持久 request-id 去重独立防止并发投递或响应丢失。键由 Session id 与中断终结 seq 组成；发送前先 fsync 状态。恢复冷却 60 秒，延迟倍增至最多 30 分钟，每个人工输入阶段最多投递五次。结果不明的发送消耗预算，并复用同一 request id。新的人工输入开始新阶段。可选 `sessionIds` 将巡检限制为显式名单。

`state.json` 记录投递意图与结果。`scans.jsonl` 记录巡检、跳过、接受及匹配的后续执行事件。`accepted-awaiting-execution` 不表示完成：`execution-observed` 标识匹配的重试输入或队列唤醒回执、后续轮次及其终结。有限历史窗口找不到未解决的投递时，会停止该阶段，等待运维对账。升级时保留状态；删除状态会重置重试预算。巡检不编辑 Session 文件、权限、目标、提供方配置或工具结果。

## 设备范围

每个巡检只针对一个配置的 origin 和状态目录。NAS 任务只扫描 NAS Host。worker 默认不安装 task-center：远端恢复需要通过已有 bridge 明确提供可达的已认证 worker 端点，并使用独立巡检配置和状态目录。此改动不启用远端扫描，也不声称覆盖全部设备。

## 停止与回滚

将已有任务的 `enabled` 设为 false，可停止定时巡检。将巡检配置的 `enabled` 设为 false，也可禁用恢复。这两种操作均不取消已接受的任务；需要时通过常规 UI 停止对应 Session。保留 `state.json` 与 Session 日志。先禁用任务，再回滚巡检产物。不认识必需恢复撤销事件的旧核心必须拒绝读取相关日志；打开这些 Session 时保留此核心版本或后续版本。

## Worker 验证

`python3 -m unittest discover -s scripts/session-recovery -p 'test_*.py' -v` 覆盖巡检持久化、响应丢失、锁竞争、退避和执行观测。`node scripts/session-recovery/acceptance.mjs` 启动隔离的已构建 Web profile，使用确定性的外部模型，先完成一次工具副作用，在下一次模型请求中杀进程，重启后运行巡检，并检查恢复完成且副作用仅一次。它保留私有临时证据目录，并停止自己启动的 Web 进程。先构建当前核心产物。整个过程不使用生产凭据或生产服务。`RECOVERY_CASE=queue node scripts/session-recovery/acceptance.mjs` 验证 transport 失败后恢复已有队列指令，保留其异步派发设置，并确认没有追加重试。
