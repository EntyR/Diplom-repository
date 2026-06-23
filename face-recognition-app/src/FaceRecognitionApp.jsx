import { useState, useRef, useCallback, createContext, useContext } from "react";

const FolderContext = createContext({ fileMap: {}, folderName: null });

const API_BASE = "http://91.209.135.149:8080";

const TABS = [
  { id: "identify", label: "Идентификация", icon: "ti-scan" },
  { id: "register", label: "Регистрация", icon: "ti-user-plus" },
  { id: "gallery", label: "Галерея", icon: "ti-users" },
];

function Avatar({ subjectId, size = 48 }) {
  const colors = [
    ["#E6F1FB", "#0C447C"],
    ["#E1F5EE", "#085041"],
    ["#EEEDFE", "#3C3489"],
    ["#FAEEDA", "#633806"],
    ["#FAECE7", "#712B13"],
    ["#EAF3DE", "#27500A"],
  ];
  const idx = subjectId ? subjectId.charCodeAt(0) % colors.length : 0;
  const [bg, fg] = colors[idx];
  const letters = subjectId ? subjectId.slice(0, 2).toUpperCase() : "??";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.35,
        fontWeight: 500,
        flexShrink: 0,
        fontFamily: "monospace",
        letterSpacing: 1,
      }}
    >
      {letters}
    </div>
  );
}

function FolderPicker({ onFolder }) {
  const [loading, setLoading] = useState(false);
  const supported = "showDirectoryPicker" in window;

  const pick = async () => {
    if (!supported) return;
    setLoading(true);
    try {
      const dir = await window.showDirectoryPicker({ mode: "read" });
      const map = {};
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === "file" && /\.(jpe?g|png|webp|gif|bmp)$/i.test(name)) {
          const file = await handle.getFile();
          map[name] = URL.createObjectURL(file);
        }
      }
      onFolder({ name: dir.name, fileMap: map });
    } catch (e) {
      if (e.name !== "AbortError") console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (!supported) return (
    <div style={{ background: "#FAEEDA", border: "0.5px solid #FAC775", borderRadius: "var(--border-radius-md)", padding: "10px 14px", fontSize: 12, color: "#633806" }}>
      <i className="ti ti-alert-triangle" style={{ marginRight: 6, verticalAlign: -2 }} aria-hidden="true" />
      Ваш браузер не поддерживает выбор папки. Используйте Chrome или Edge.
    </div>
  );

  return (
    <button onClick={pick} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", fontSize: 13 }}>
      {loading
        ? <><i className="ti ti-loader-2" style={{ fontSize: 15, animation: "spin 1s linear infinite" }} aria-hidden="true" /> Загрузка...</>
        : <><i className="ti ti-folder-open" style={{ fontSize: 15 }} aria-hidden="true" /> Выбрать папку с фото</>}
    </button>
  );
}

function SourceImage({ source }) {
  const { fileMap } = useContext(FolderContext);
  const filename = source.split(/[\\/]/).pop();
  const url = fileMap[filename] || fileMap[source];

  if (!url) return (
    <div style={{
      width: 56, height: 56, borderRadius: 8, background: "var(--color-background-secondary)",
      border: "0.5px solid var(--color-border-tertiary)", display: "flex",
      alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <i className="ti ti-photo-off" style={{ fontSize: 20, color: "var(--color-text-secondary)" }} aria-hidden="true" />
    </div>
  );

  return (
    <img src={url} alt={filename}
      style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: "0.5px solid var(--color-border-tertiary)" }} />
  );
}

function ScoreBadge({ score }) {
  const pct = Math.round(score * 100);
  let bg, color;
  if (pct >= 75) { bg = "#EAF3DE"; color = "#27500A"; }
  else if (pct >= 50) { bg = "#FAEEDA"; color = "#633806"; }
  else { bg = "#FCEBEB"; color = "#791F1F"; }
  return (
    <span style={{ background: bg, color, fontSize: 12, fontWeight: 500, padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
      {pct}% совпадение
    </span>
  );
}

function ActionBadge({ status }) {
  const map = {
    matched:          { label: "Найден",         bg: "#EAF3DE", color: "#27500A" },
    enrolled:         { label: "Создан",          bg: "#E6F1FB", color: "#0C447C" },
    not_found:        { label: "Не найден",       bg: "#FAEEDA", color: "#633806" },
    no_face:          { label: "Лицо не найдено", bg: "#FCEBEB", color: "#791F1F" },
  };
  const { label, bg, color } = map[status] || { label: status, bg: "#F1EFE8", color: "#444441" };
  return (
    <span style={{ background: bg, color, fontSize: 12, fontWeight: 500, padding: "3px 12px", borderRadius: 20 }}>
      {label}
    </span>
  );
}

function DropZone({ onFile, preview, label = "Перетащите фото сюда или нажмите для выбора" }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  }, [onFile]);

  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `1.5px dashed ${dragging ? "#378ADD" : "var(--color-border-secondary)"}`,
        borderRadius: "var(--border-radius-lg)",
        background: dragging ? "#E6F1FB" : "var(--color-background-secondary)",
        minHeight: 180,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "border-color 0.2s, background 0.2s",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files[0]; if (f) onFile(f); }} />
      {preview ? (
        <img src={preview} alt="preview" style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 8 }} />
      ) : (
        <>
          <i className="ti ti-camera-plus" style={{ fontSize: 36, color: "var(--color-text-secondary)", marginBottom: 10 }} aria-hidden="true" />
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0, textAlign: "center", padding: "0 1rem" }}>{label}</p>
        </>
      )}
    </div>
  );
}

function SubjectCard({ subject, showOrigins = false }) {
  if (!subject) return null;
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "1rem 1.25rem",
      display: "flex",
      alignItems: "flex-start",
      gap: 14,
    }}>
      <Avatar subjectId={subject.subject_id} size={48} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 500, fontSize: 14, margin: "0 0 2px", color: "var(--color-text-primary)", wordBreak: "break-all" }}>
          {subject.subject_id || "Без ID"}
        </p>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0 }}>
          {subject.origins?.length || 0} фото в базе
        </p>
        {showOrigins && subject.origins?.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {subject.origins.map((src, i) => (
              <span key={i} style={{
                fontSize: 11, background: "var(--color-background-secondary)",
                color: "var(--color-text-secondary)", padding: "2px 8px",
                borderRadius: 12, border: "0.5px solid var(--color-border-tertiary)",
                maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}>{src}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IdentifyTab() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [threshold, setThreshold] = useState(0.35);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState(null);

  const handleFile = (f) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
    setCreateResult(null);
    setCreating(false);
  };

  const identify = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setCreating(false);
    setCreateResult(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`${API_BASE}/verify?allow_enroll=false&cutoff=${threshold}`, {
        method: "POST", body: fd,
      });
      if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
      setResult(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const createNew = async () => {
    if (!file) return;
    setCreating(true);
    setError(null);
    setCreateResult(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`${API_BASE}/subjects`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
      setCreateResult(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const reset = () => {
    setFile(null); setPreview(null); setResult(null);
    setError(null); setCreateResult(null); setCreating(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem" }}>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 12px", fontWeight: 500 }}>
          <i className="ti ti-sliders-horizontal" style={{ marginRight: 6, verticalAlign: -2 }} aria-hidden="true" />
          Порог совпадения: {Math.round(threshold * 100)}%
        </p>
        <input type="range" min="0.1" max="0.9" step="0.01" value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          style={{ width: "100%" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--color-text-secondary)", marginTop: 4 }}>
          <span>Строже (10%)</span><span>Мягче (90%)</span>
        </div>
      </div>

      <DropZone onFile={handleFile} preview={preview} />

      {preview && !result && !createResult && (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={identify} disabled={loading} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0" }}>
            {loading
              ? <><i className="ti ti-loader-2" style={{ fontSize: 16, animation: "spin 1s linear infinite" }} aria-hidden="true" /> Поиск...</>
              : <><i className="ti ti-scan" style={{ fontSize: 16 }} aria-hidden="true" /> Идентифицировать</>}
          </button>
          <button onClick={reset} style={{ padding: "10px 16px" }}>
            <i className="ti ti-refresh" style={{ fontSize: 16 }} aria-hidden="true" />
          </button>
        </div>
      )}

      {error && (
        <div style={{ background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: "var(--border-radius-md)", padding: "12px 16px", color: "#791F1F", fontSize: 13 }}>
          <i className="ti ti-alert-circle" style={{ marginRight: 8, verticalAlign: -2 }} aria-hidden="true" />
          {error}
        </div>
      )}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>Результат:</span>
            <ActionBadge status={result.status} />
            {result.similarity != null && <ScoreBadge score={result.similarity} />}
          </div>

          {result.status === "matched" && result.subject && (
            <>
              <SubjectCard subject={result.subject} showOrigins />
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={reset} style={{ flex: 1, padding: "9px 0" }}>
                  <i className="ti ti-arrow-left" style={{ fontSize: 15, marginRight: 6 }} aria-hidden="true" />
                  Новый поиск
                </button>
              </div>
            </>
          )}

          {(result.status === "not_found" || result.status === "no_face") && (
            <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem" }}>
              {result.status === "no_face" ? (
                <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>
                  <i className="ti ti-face-id-error" style={{ fontSize: 18, marginRight: 8, verticalAlign: -3 }} aria-hidden="true" />
                  Лицо не обнаружено на фотографии. Попробуйте другое изображение.
                </p>
              ) : (
                <>
                  <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--color-text-primary)", fontWeight: 500 }}>
                    Человек не найден в базе
                  </p>
                  <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                    Хотите зарегистрировать этого человека как нового пользователя?
                  </p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={createNew} disabled={creating} style={{ flex: 1, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      {creating
                        ? <><i className="ti ti-loader-2" style={{ fontSize: 15, animation: "spin 1s linear infinite" }} aria-hidden="true" /> Создание...</>
                        : <><i className="ti ti-user-plus" style={{ fontSize: 15 }} aria-hidden="true" /> Создать нового пользователя</>}
                    </button>
                    <button onClick={reset} style={{ padding: "9px 16px" }}>Отмена</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {createResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#EAF3DE", border: "0.5px solid #97C459", borderRadius: "var(--border-radius-md)", padding: "12px 16px", color: "#27500A", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-circle-check" style={{ fontSize: 18 }} aria-hidden="true" />
            Пользователь успешно создан!
          </div>
          <SubjectCard subject={createResult} showOrigins />
          <button onClick={reset} style={{ padding: "9px 0" }}>
            <i className="ti ti-arrow-left" style={{ fontSize: 15, marginRight: 6 }} aria-hidden="true" />
            Новый поиск
          </button>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function RegisterTab() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFile = (f) => {
    setFile(f); setPreview(URL.createObjectURL(f));
    setResult(null); setError(null);
  };

  const register = async () => {
    if (!file) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`${API_BASE}/subjects`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Ошибка ${res.status}`);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(null); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "12px 16px", fontSize: 13, color: "var(--color-text-secondary)", display: "flex", gap: 10, alignItems: "flex-start" }}>
        <i className="ti ti-info-circle" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
        <span>Загрузите фотографию нового человека. Система создаст уникальный профиль на основе распознанного лица.</span>
      </div>

      <DropZone onFile={handleFile} preview={preview} label="Загрузите фото нового пользователя" />

      {preview && !result && (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={register} disabled={loading} style={{ flex: 1, padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {loading
              ? <><i className="ti ti-loader-2" style={{ fontSize: 16, animation: "spin 1s linear infinite" }} aria-hidden="true" /> Создание...</>
              : <><i className="ti ti-user-plus" style={{ fontSize: 16 }} aria-hidden="true" /> Зарегистрировать</>}
          </button>
          <button onClick={reset} style={{ padding: "10px 16px" }}>
            <i className="ti ti-refresh" style={{ fontSize: 16 }} aria-hidden="true" />
          </button>
        </div>
      )}

      {error && (
        <div style={{ background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: "var(--border-radius-md)", padding: "12px 16px", color: "#791F1F", fontSize: 13 }}>
          <i className="ti ti-alert-circle" style={{ marginRight: 8, verticalAlign: -2 }} aria-hidden="true" />
          {error}
        </div>
      )}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#EAF3DE", border: "0.5px solid #97C459", borderRadius: "var(--border-radius-md)", padding: "12px 16px", color: "#27500A", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
            <i className="ti ti-circle-check" style={{ fontSize: 18 }} aria-hidden="true" />
            Пользователь успешно зарегистрирован!
          </div>

          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <Avatar subjectId={result.subject_id} size={56} />
              <div>
                <p style={{ fontWeight: 500, margin: "0 0 2px", fontSize: 15, color: "var(--color-text-primary)" }}>Новый пользователь</p>
                <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0 }}>Профиль создан</p>
              </div>
            </div>
            <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 12 }}>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>ID пользователя</div>
              <code style={{ fontSize: 12, background: "var(--color-background-secondary)", padding: "4px 8px", borderRadius: 6, wordBreak: "break-all", display: "block", color: "var(--color-text-primary)" }}>
                {result.subject_id}
              </code>
            </div>
            {result.origins?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>Фотографии</div>
                {result.origins.map((src, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "3px 0", display: "flex", alignItems: "center", gap: 6 }}>
                    <i className="ti ti-photo" style={{ fontSize: 14 }} aria-hidden="true" />
                    <span style={{ wordBreak: "break-all" }}>{src}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={reset} style={{ padding: "9px 0" }}>
            <i className="ti ti-plus" style={{ fontSize: 15, marginRight: 6 }} aria-hidden="true" />
            Добавить ещё одного
          </button>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function AddFaceModal({ subject, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = (f) => {
    setFile(f); setPreview(URL.createObjectURL(f)); setError(null);
  };

  const submit = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`${API_BASE}/subjects/${subject.subject_id}/portraits`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Ошибка ${res.status}`);
      }
      onSuccess(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-xl)", padding: "1.5rem", width: "min(440px, 92vw)", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <p style={{ fontWeight: 500, fontSize: 15, margin: 0, color: "var(--color-text-primary)" }}>Добавить фото</p>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", padding: 4, color: "var(--color-text-secondary)" }}>
            <i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" />
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 14px" }}>
          Пользователь: <code style={{ fontSize: 11, background: "var(--color-background-secondary)", padding: "2px 6px", borderRadius: 4 }}>{subject.subject_id?.slice(0, 16)}...</code>
        </p>
        <DropZone onFile={handleFile} preview={preview} label="Фото для добавления" />
        {error && (
          <div style={{ marginTop: 12, background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: "var(--border-radius-md)", padding: "10px 14px", color: "#791F1F", fontSize: 13 }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={submit} disabled={!file || loading} style={{ flex: 1, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {loading
              ? <><i className="ti ti-loader-2" style={{ fontSize: 15, animation: "spin 1s linear infinite" }} aria-hidden="true" /> Добавление...</>
              : <><i className="ti ti-camera-plus" style={{ fontSize: 15 }} aria-hidden="true" /> Добавить</>}
          </button>
          <button onClick={onClose} style={{ padding: "9px 20px" }}>Отмена</button>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function GalleryTab() {
  const [subjectId, setSubjectId] = useState("");
  const [subject, setSubject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [addModal, setAddModal] = useState(false);
  const [removingOrigin, setRemovingOrigin] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const fetchSubject = async (id) => {
    if (!id.trim()) return;
    setLoading(true); setError(null); setSubject(null); setSuccessMsg(null);
    try {
      const res = await fetch(`${API_BASE}/subjects/${id.trim()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Ошибка ${res.status}`);
      }
      setSubject(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const removePortrait = async (origin) => {
    setRemovingOrigin(origin); setError(null);
    try {
      const params = new URLSearchParams({ origin });
      const res = await fetch(`${API_BASE}/subjects/${subject.subject_id}/portraits?${params}`, { method: "DELETE" });
      if (res.status === 204) {
        setSubject(null);
        setSuccessMsg("Пользователь удалён — у него была только одна фотография.");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Ошибка ${res.status}`);
      }
      const updated = await res.json();
      setSubject(updated);
      setSuccessMsg("Фотография удалена.");
    } catch (e) {
      setError(e.message);
    } finally {
      setRemovingOrigin(null);
    }
  };

  const handleAddSuccess = (updated) => {
    setAddModal(false);
    setSubject(updated);
    setSuccessMsg("Фотография добавлена!");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem" }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", margin: "0 0 10px" }}>Поиск пользователя по ID</p>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            type="text"
            placeholder="Введите subject_id..."
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchSubject(subjectId)}
            style={{ flex: 1, fontSize: 13 }}
          />
          <button onClick={() => fetchSubject(subjectId)} disabled={loading || !subjectId.trim()} style={{ padding: "9px 20px", display: "flex", alignItems: "center", gap: 8 }}>
            {loading
              ? <i className="ti ti-loader-2" style={{ fontSize: 15, animation: "spin 1s linear infinite" }} aria-hidden="true" />
              : <i className="ti ti-search" style={{ fontSize: 15 }} aria-hidden="true" />}
            Найти
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: "var(--border-radius-md)", padding: "12px 16px", color: "#791F1F", fontSize: 13 }}>
          <i className="ti ti-alert-circle" style={{ marginRight: 8, verticalAlign: -2 }} aria-hidden="true" />
          {error}
        </div>
      )}

      {successMsg && (
        <div style={{ background: "#EAF3DE", border: "0.5px solid #97C459", borderRadius: "var(--border-radius-md)", padding: "12px 16px", color: "#27500A", fontSize: 13 }}>
          <i className="ti ti-circle-check" style={{ marginRight: 8, verticalAlign: -2 }} aria-hidden="true" />
          {successMsg}
        </div>
      )}

      {subject && (
        <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar subjectId={subject.subject_id} size={52} />
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 2px", color: "var(--color-text-primary)" }}>Профиль пользователя</p>
              <code style={{ fontSize: 11, color: "var(--color-text-secondary)", background: "var(--color-background-secondary)", padding: "2px 6px", borderRadius: 4, wordBreak: "break-all" }}>
                {subject.subject_id}
              </code>
            </div>
            <button onClick={() => setAddModal(true)} style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <i className="ti ti-camera-plus" style={{ fontSize: 15 }} aria-hidden="true" />
              Добавить фото
            </button>
          </div>

          <div style={{ padding: "1rem 1.25rem" }}>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 12px", fontWeight: 500 }}>
              Фотографии ({subject.origins?.length || 0})
            </p>
            {subject.origins?.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {subject.origins.map((src, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: "var(--color-background-secondary)",
                    borderRadius: "var(--border-radius-md)",
                    padding: "10px 14px",
                    border: "0.5px solid var(--color-border-tertiary)"
                  }}>
                    <SourceImage source={src} />
                    <span style={{ flex: 1, fontSize: 13, color: "var(--color-text-primary)", wordBreak: "break-all" }}>{src}</span>
                    <button
                      onClick={() => removePortrait(src)}
                      disabled={removingOrigin === src}
                      style={{ padding: "6px 10px", color: "#791F1F", borderColor: "#F09595", background: "transparent", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
                    >
                      {removingOrigin === src
                        ? <i className="ti ti-loader-2" style={{ fontSize: 14, animation: "spin 1s linear infinite" }} aria-hidden="true" />
                        : <i className="ti ti-trash" style={{ fontSize: 14 }} aria-hidden="true" />}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>Нет фотографий</p>
            )}
          </div>
        </div>
      )}

      {addModal && subject && (
        <AddFaceModal subject={subject} onClose={() => setAddModal(false)} onSuccess={handleAddSuccess} />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("identify");
  const [folder, setFolder] = useState({ fileMap: {}, folderName: null });

  return (
    <FolderContext.Provider value={folder}>
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)", fontFamily: "var(--font-sans)" }}>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css" />

      <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 0 3rem" }}>
        <div style={{ padding: "2rem 1.5rem 1rem", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#EEEDFE", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className="ti ti-face-id" style={{ fontSize: 20, color: "#3C3489" }} aria-hidden="true" />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0, color: "var(--color-text-primary)" }}>Face Recognition</h1>
          </div>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 14px" }}>Система идентификации и управления пользователями</p>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <FolderPicker onFolder={setFolder} />
            {folder.folderName && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-secondary)" }}>
                <i className="ti ti-folder-check" style={{ fontSize: 15, color: "#27500A" }} aria-hidden="true" />
                <span style={{ color: "#27500A", fontWeight: 500 }}>{folder.folderName}</span>
                <span style={{ color: "var(--color-text-secondary)" }}>— {Object.keys(folder.fileMap).length} фото загружено</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", borderBottom: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-primary)" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: "13px 0",
                border: "none", borderBottom: tab === t.id ? "2px solid #3C3489" : "2px solid transparent",
                background: "transparent",
                cursor: "pointer",
                color: tab === t.id ? "#3C3489" : "var(--color-text-secondary)",
                fontSize: 13, fontWeight: tab === t.id ? 500 : 400,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                transition: "color 0.15s",
              }}
            >
              <i className={`ti ${t.icon}`} style={{ fontSize: 16 }} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: "1.5rem" }}>
          {tab === "identify" && <IdentifyTab />}
          {tab === "register" && <RegisterTab />}
          {tab === "gallery" && <GalleryTab />}
        </div>
      </div>
    </div>
    </FolderContext.Provider>
  );
}