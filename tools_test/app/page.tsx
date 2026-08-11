"use client";

import { useMemo, useState } from "react";

type Direction = "front" | "back" | "left" | "right";
type EndpointStatus = "꺼짐" | "확인 중" | "연결됨" | "오류";
type JobStatus = "입력 준비" | "대기열" | "생성 중" | "영상 완료" | "실패";

type DirectionInput = {
  referenceImage: string;
  referenceMask: string;
  drivingVideo: string;
  drivingMask: string;
};

type JobState = {
  status: JobStatus;
  jobId?: string;
  outputPath?: string;
  runtimeSeconds?: number;
  error?: string;
};

type EndpointState = {
  status: EndpointStatus;
  modelState?: string;
  queueDepth?: number;
  message?: string;
};

const DIRECTIONS = [
  { id: "front", label: "정면", code: "F", camera: "0°" },
  { id: "back", label: "후면", code: "B", camera: "180°" },
  { id: "left", label: "왼쪽", code: "L", camera: "-90°" },
  { id: "right", label: "오른쪽", code: "R", camera: "+90°" },
] as const;

const PHASES = [
  "L Contact",
  "L Loading",
  "R Passing",
  "L Heel Rise",
  "R Contact",
  "R Loading",
  "L Passing",
  "R Heel Rise",
] as const;

const EXTRACT_INDICES = [0, 2, 4, 6, 8, 10, 12, 14] as const;

const PROMPTS: Record<Direction, string> = {
  front: "A full-body 2D game character performs one seamless in-place walk cycle in a fixed orthographic front view. The camera, framing, character scale, identity, costume, colors, and ground baseline remain constant.",
  back: "A full-body 2D game character performs one seamless in-place walk cycle in a fixed orthographic back view. The camera, framing, character scale, identity, costume, colors, and ground baseline remain constant.",
  left: "A full-body 2D game character performs one seamless in-place walk cycle in a fixed orthographic left-profile view. The camera, framing, character scale, identity, costume, colors, and ground baseline remain constant.",
  right: "A full-body 2D game character performs one seamless in-place walk cycle in a fixed orthographic right-profile view. The camera, framing, character scale, identity, costume, colors, and ground baseline remain constant.",
};

function createInputs(projectId: string): Record<Direction, DirectionInput> {
  const safeId = projectId.trim() || "CHARACTER_ID";
  return Object.fromEntries(DIRECTIONS.map((direction) => [direction.id, {
    referenceImage: `references/${safeId}/${direction.id}/ref.jpg`,
    referenceMask: `references/${safeId}/${direction.id}/ref_mask.jpg`,
    drivingVideo: `drivers/master-walk-17f/${direction.id}/rendered_v2.mp4`,
    drivingMask: `drivers/master-walk-17f/${direction.id}/rendered_mask_v2.mp4`,
  }])) as Record<Direction, DirectionInput>;
}

function createJobs(): Record<Direction, JobState> {
  return Object.fromEntries(DIRECTIONS.map((direction) => [direction.id, { status: "입력 준비" }])) as Record<Direction, JobState>;
}

export default function Home() {
  const [projectId, setProjectId] = useState("character-001");
  const [activeDirection, setActiveDirection] = useState<Direction>("front");
  const [inputs, setInputs] = useState<Record<Direction, DirectionInput>>(() => createInputs("character-001"));
  const [prompts, setPrompts] = useState<Record<Direction, string>>(PROMPTS);
  const [jobs, setJobs] = useState<Record<Direction, JobState>>(() => createJobs());
  const [endpoint, setEndpoint] = useState<EndpointState>({ status: "꺼짐" });
  const [notice, setNotice] = useState("방향별 canonical reference와 master walk driver를 Network Volume에 준비하세요.");
  const [submitting, setSubmitting] = useState(false);
  const [seed, setSeed] = useState(4821);

  const selectedDirection = useMemo(
    () => DIRECTIONS.find((direction) => direction.id === activeDirection) ?? DIRECTIONS[0],
    [activeDirection],
  );

  function applyProjectPaths() {
    setInputs(createInputs(projectId));
    setJobs(createJobs());
    setNotice(`${projectId || "CHARACTER_ID"} 경로 템플릿을 적용했습니다. 실제 파일은 로컬 클라이언트가 S3 API로 업로드합니다.`);
  }

  function updateInput(key: keyof DirectionInput, value: string) {
    setInputs((current) => ({
      ...current,
      [activeDirection]: { ...current[activeDirection], [key]: value },
    }));
    setJobs((current) => ({ ...current, [activeDirection]: { status: "입력 준비" } }));
  }

  async function checkHealth() {
    setEndpoint({ status: "확인 중" });
    setNotice("SCAIL-2 Pod와 단일 GPU worker 상태를 확인 중입니다.");
    try {
      const response = await fetch("/api/scail2/health", { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; model_state?: string; queue_depth?: number; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.message || `HTTP ${response.status}`);
      setEndpoint({ status: "연결됨", modelState: body.model_state, queueDepth: body.queue_depth });
      setNotice(`Pod 연결 완료 · model ${body.model_state ?? "unknown"} · queue ${body.queue_depth ?? 0}`);
      console.info("[SCAIL_CONSOLE][HEALTH_OK]", body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pod 연결 실패";
      setEndpoint({ status: "오류", message });
      setNotice(`Pod 연결 실패 · ${message}`);
      console.error("[SCAIL_CONSOLE][HEALTH_FAILED]", { message });
    }
  }

  async function pollJob(direction: Direction, jobId: string) {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      try {
        const response = await fetch(`/api/scail2/jobs/${jobId}`, { cache: "no-store" });
        const body = await response.json() as { status?: string; output_path?: string; runtime_seconds?: number; error?: string };
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        const status: JobStatus = body.status === "completed"
          ? "영상 완료"
          : body.status === "failed"
            ? "실패"
            : body.status === "running"
              ? "생성 중"
              : "대기열";
        setJobs((current) => ({
          ...current,
          [direction]: {
            ...current[direction],
            status,
            outputPath: body.output_path,
            runtimeSeconds: body.runtime_seconds,
            error: body.error,
          },
        }));
        if (status === "영상 완료" || status === "실패") {
          setNotice(`${DIRECTIONS.find((item) => item.id === direction)?.label} 작업 ${status}. 영상 완료 뒤 로컬 클라이언트가 다운로드와 8 phase 추출을 수행합니다.`);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "작업 조회 실패";
        setJobs((current) => ({ ...current, [direction]: { ...current[direction], status: "실패", error: message } }));
        setNotice(`${direction} 작업 조회 실패 · ${message}`);
        return;
      }
    }
  }

  async function submitJob(direction: Direction) {
    const directionInputs = inputs[direction];
    const response = await fetch("/api/scail2/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction,
        prompt: prompts[direction],
        reference_image: directionInputs.referenceImage,
        reference_mask: directionInputs.referenceMask,
        driving_video: directionInputs.drivingVideo,
        driving_mask: directionInputs.drivingMask,
        target_width: 896,
        target_height: 512,
        sample_steps: 40,
        sample_shift: 3,
        sample_guide_scale: 5,
        sample_solver: "unipc",
        seed,
      }),
    });
    const body = await response.json() as { job_id?: string; error?: string };
    if (!response.ok || !body.job_id) throw new Error(body.error || "작업 등록 실패");
    setJobs((current) => ({ ...current, [direction]: { status: "대기열", jobId: body.job_id } }));
    console.info("[SCAIL_CONSOLE][JOB_QUEUED]", { direction, jobId: body.job_id });
    void pollJob(direction, body.job_id);
  }

  async function submitSelected() {
    if (submitting || endpoint.status !== "연결됨") return;
    setSubmitting(true);
    setNotice(`${selectedDirection.label} 한 cycle job을 등록합니다.`);
    try {
      await submitJob(activeDirection);
    } catch (error) {
      const message = error instanceof Error ? error.message : "작업 등록 실패";
      setJobs((current) => ({ ...current, [activeDirection]: { status: "실패", error: message } }));
      setNotice(`${selectedDirection.label} 등록 실패 · ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAll() {
    if (submitting || endpoint.status !== "연결됨") return;
    setSubmitting(true);
    setNotice("정면 → 후면 → 왼쪽 → 오른쪽 순서로 job_id를 등록합니다. GPU worker는 한 작업씩 실행합니다.");
    try {
      for (const direction of DIRECTIONS) await submitJob(direction.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "4방향 등록 실패";
      setNotice(`4방향 등록 중단 · ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  function downloadManifest() {
    const payload = {
      project_id: projectId,
      data_root: "/workspace/scail2-data",
      views: Object.fromEntries(DIRECTIONS.map((direction) => [direction.id, {
        local_reference_image: `inputs/${projectId}/${direction.id}/ref.jpg`,
        local_reference_mask: `inputs/${projectId}/${direction.id}/ref_mask.jpg`,
        local_driving_video: `inputs/master-walk-17f/${direction.id}/rendered_v2.mp4`,
        local_driving_mask: `inputs/master-walk-17f/${direction.id}/rendered_mask_v2.mp4`,
        reference_image: inputs[direction.id].referenceImage,
        reference_mask: inputs[direction.id].referenceMask,
        driving_video: inputs[direction.id].drivingVideo,
        driving_mask: inputs[direction.id].drivingMask,
        prompt: prompts[direction.id],
      }])),
      generation: { width: 896, height: 512, steps: 40, shift: 3, cfg: 5, solver: "unipc", seed },
      local_extract: { indices: EXTRACT_INDICES },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectId || "scail2"}-manifest.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const selectedJob = jobs[activeDirection];
  const canSubmit = Object.values(inputs[activeDirection]).every((value) => value.trim()) && prompts[activeDirection].trim();

  return (
    <main className="app-shell scail-console">
      <header className="topbar scail-console-topbar">
        <div className="brand"><span>S2</span><div><small>LOCAL SCAIL PRODUCTION CLIENT</small><h1>4-View Walk Factory</h1></div></div>
        <div className="topology-title">local assets / network volume / one GPU worker</div>
        <div className="endpoint-cluster"><div className="runpod-state" data-status={endpoint.status}><i /><strong>SCAIL-2 {endpoint.status}</strong></div><button type="button" className="secondary-button" onClick={checkHealth} data-testid="check-scail-runpod">Pod 연결 확인</button></div>
      </header>

      <nav className="phase-rail" aria-label="production stages">
        <div className="phase is-ready"><span>01</span><div><strong>Canonical 4방향</strong><small>준비된 입력 이미지·마스크</small></div></div>
        <div className="phase is-ready"><span>02</span><div><strong>Master Walk 17F</strong><small>한 motion · 네 고정 camera</small></div></div>
        <div className="phase is-active"><span>03</span><div><strong>SCAIL-2 4 Jobs</strong><small>방향당 한 cycle 영상</small></div></div>
        <div className="phase"><span>04</span><div><strong>Local 8-Phase Pick</strong><small>4×8 = 32 PNG</small></div></div>
      </nav>

      <section className="architecture-map" data-testid="architecture-map">
        <article><small>LOCAL PC</small><strong>4 refs + 4 drivers</strong><span>S3-compatible upload</span></article><b>→</b>
        <article><small>NETWORK VOLUME</small><strong>/workspace/scail2-data</strong><span>prepared inputs + raw outputs</span></article><b>→</b>
        <article className="is-primary"><small>ON-DEMAND POD</small><strong>SCAIL-2 loaded once</strong><span>FastAPI :8000 · serial GPU queue</span></article><b>→</b>
        <article><small>LOCAL CLIENT</small><strong>download raw videos</strong><span>0·2·4·6·8·10·12·14</span></article>
      </section>

      <section className="scail-console-grid">
        <aside className="scail-project-panel">
          <header><small>PROJECT MANIFEST</small><h2>입력 구조</h2></header>
          <label><span>캐릭터 ID</span><input value={projectId} onChange={(event) => setProjectId(event.target.value)} data-testid="scail-project-id" /></label>
          <button type="button" onClick={applyProjectPaths} data-testid="apply-scail-path-template">Volume 경로 적용</button>
          <button type="button" onClick={downloadManifest} data-testid="download-scail-manifest">로컬 manifest 저장</button>
          <div className="input-rule"><strong>Reference</strong><p>정면·후면·좌·우 standing neutral 이미지와 각 reference mask를 별도로 준비합니다.</p></div>
          <div className="input-rule"><strong>Master Motion</strong><p>하나의 rig·하나의 17-frame closed walk를 네 고정 camera로 렌더합니다.</p></div>
          <div className="input-rule"><strong>전처리 분리</strong><p>SCAIL-Pose mask 생성은 asset 준비 단계에서 한 번 수행합니다. generation endpoint가 매번 전처리하지 않습니다.</p></div>
          <div className="notice-box"><i />{notice}</div>
        </aside>

        <section className="scail-direction-panel">
          <div className="scail-direction-tabs" role="tablist" aria-label="방향 선택">
            {DIRECTIONS.map((direction) => <button type="button" role="tab" aria-selected={activeDirection === direction.id} className={activeDirection === direction.id ? "is-active" : ""} key={direction.id} onClick={() => setActiveDirection(direction.id)} data-testid={`scail-direction-${direction.id}`}><span>{direction.code}</span><strong>{direction.label}</strong><small>{direction.camera} · {jobs[direction.id].status}</small></button>)}
          </div>

          <div className="direction-editor">
            <header><div><small>{selectedDirection.code} / {selectedDirection.camera}</small><h2>{selectedDirection.label} 한 cycle 입력</h2></div><span>Animation Mode · replace_flag=false</span></header>
            <div className="direction-input-grid">
              {([
                ["referenceImage", "REFERENCE RGB", "ref.jpg"],
                ["referenceMask", "REFERENCE MASK", "ref_mask.jpg"],
                ["drivingVideo", "DRIVING RGB 17F", "rendered_v2.mp4"],
                ["drivingMask", "DRIVING MASK 17F", "rendered_mask_v2.mp4"],
              ] as const).map(([key, title, filename]) => <label key={key}><span><b>{title}</b><small>{filename}</small></span><input value={inputs[activeDirection][key]} onChange={(event) => updateInput(key, event.target.value)} data-testid={`scail-path-${activeDirection}-${key}`} /></label>)}
            </div>
            <label className="prompt-editor"><span>생성될 영상 설명</span><textarea rows={5} value={prompts[activeDirection]} onChange={(event) => setPrompts((current) => ({ ...current, [activeDirection]: event.target.value }))} data-testid={`scail-prompt-${activeDirection}`} /></label>
            <div className="scail-params"><span><small>SIZE</small><strong>896×512</strong></span><span><small>STEPS</small><strong>40</strong></span><span><small>SHIFT</small><strong>3.0</strong></span><span><small>CFG</small><strong>5.0</strong></span><span><small>SOLVER</small><strong>UniPC</strong></span><label><small>SEED</small><input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label></div>
            <div className="job-actions"><div><strong>{selectedJob.status}</strong><small>{selectedJob.jobId ?? "job_id 대기"}</small></div><button type="button" onClick={submitSelected} disabled={endpoint.status !== "연결됨" || submitting || !canSubmit} data-testid="queue-selected-scail-job">{selectedDirection.label} cycle 등록</button><button type="button" onClick={submitAll} disabled={endpoint.status !== "연결됨" || submitting} data-testid="queue-all-scail-jobs">4방향 순서대로 등록</button></div>
          </div>
        </section>
      </section>

      <section className="job-board" data-testid="scail-job-board">
        <header><div><small>POD JOB QUEUE</small><h2>4방향 원본 영상</h2></div><span>model {endpoint.modelState ?? "unknown"} · queue {endpoint.queueDepth ?? 0}</span></header>
        <div className="job-card-grid">
          {DIRECTIONS.map((direction) => {
            const job = jobs[direction.id];
            return <article key={direction.id} className={`job-card is-${job.status.replace(" ", "-")}`}><header><span>{direction.code}</span><div><strong>{direction.label} 17F cycle</strong><small>{job.status}</small></div></header><div className="job-flow"><span>ref</span><b>+</b><span>driver</span><b>→</b><span>raw mp4</span></div><strong>{job.jobId ?? "작업 미등록"}</strong><small>{job.outputPath ?? "Network Volume output 대기"}</small>{job.runtimeSeconds ? <p>runtime {job.runtimeSeconds.toFixed(1)}s</p> : null}{job.error ? <p className="job-error">{job.error}</p> : null}</article>;
          })}
        </div>
      </section>

      <section className="frame-board" data-testid="local-frame-extraction">
        <header><div><small>LOCAL POST GENERATION</small><h2>동일 phase 32프레임</h2><p>Pod는 raw video까지만 생성합니다. 로컬 클라이언트가 영상을 내려받은 뒤 PNG를 추출합니다.</p></div><code>0 · 2 · 4 · 6 · 8 · 10 · 12 · 14</code></header>
        <div className="phase-header"><span>VIEW</span>{PHASES.map((phase, index) => <span key={phase}><b>{index + 1}</b><small>{phase}</small><em>F{EXTRACT_INDICES[index]}</em></span>)}</div>
        {DIRECTIONS.map((direction) => <div className="phase-row" key={direction.id}><strong>{direction.code}<small>{direction.label}</small></strong>{EXTRACT_INDICES.map((frame) => <span key={frame} className={jobs[direction.id].status === "영상 완료" ? "is-download-ready" : ""}><b>PNG</b><small>source F{frame}</small></span>)}</div>)}
        <footer><strong>Frame 16은 출력 PNG에서 제외</strong><span>Frame 0과 같은 pose인지 loop closure 검증에만 사용</span><code>python runpod/scail2_client/client.py manifest.json --views front</code></footer>
      </section>

      <section className="deployment-note">
        <div><small>RUNPOD</small><h2>On-Demand Pod</h2><p>A100 80GB 시작 · Network Volume 약 180~200GB · HTTP 8000</p></div>
        <code>POST /v1/jobs → job_id → GET /v1/jobs/&#123;id&#125;</code>
        <div><strong>로컬 환경변수</strong><small>SCAIL2_BASE_URL · SCAIL2_API_TOKEN</small><a href="https://github.com/yyeongjin/2d-assets-generator/blob/main/docs/RUNPOD_SCAIL2_GUIDE.md" target="_blank" rel="noreferrer">설치·실행 가이드</a></div>
      </section>
    </main>
  );
}
