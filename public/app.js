const $ = (id) => document.getElementById(id);

const dropzone = $('dropzone');
const fileInput = $('file-input');
const browseBtn = $('browse-btn');
const uploadSection = $('upload-section');
const settingsSection = $('settings-section');
const progressSection = $('progress-section');
const resultSection = $('result-section');

const fileName = $('file-name');
const fileMeta = $('file-meta');
const removeBtn = $('remove-btn');
const preview = $('preview');

const methodEl = $('method');
const codecEl = $('codec');
const valueSlider = $('value-slider');
const valueInput = $('value-input');
const valueLabel = $('value-label');
const valueUnit = $('value-unit');
const valueHint = $('value-hint');
const resolutionEl = $('resolution');
const audioEl = $('audio');
const presetEl = $('preset');
const compressBtn = $('compress-btn');

const progressFill = $('progress-fill');
const progressPct = $('progress-pct');
const progressSub = $('progress-sub');

const originalSizeEl = $('original-size');
const outputSizeEl = $('output-size');
const savingsEl = $('savings');
const downloadLink = $('download-link');
const restartBtn = $('restart-btn');
const resultSub = $('result-sub');

let currentJob = null;

/* ---------- helpers ---------- */
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(sec) {
  if (!sec) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

/* ---------- Dropzone ---------- */
dropzone.addEventListener('click', (e) => {
  if (e.target.closest('.link-btn')) return;
  fileInput.click();
});
browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

/* ---------- Upload ---------- */
async function handleFile(file) {
  if (!file.type.startsWith('video/')) {
    alert('Por favor selecione um arquivo de vídeo.');
    return;
  }

  const formData = new FormData();
  formData.append('video', file);

  hide(uploadSection);
  show(settingsSection);
  fileName.textContent = 'Enviando…';
  fileMeta.textContent = `${formatBytes(file.size)}`;
  preview.src = URL.createObjectURL(file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha no upload');
    }
    const data = await res.json();
    currentJob = data;
    renderMetadata(data.metadata);
  } catch (err) {
    alert('Erro: ' + err.message);
    resetAll();
  }
}

function renderMetadata(m) {
  fileName.textContent = m.filename;
  const parts = [
    formatBytes(m.size),
    `${m.width}×${m.height}`,
    formatDuration(m.duration),
    m.videoCodec.toUpperCase(),
  ];
  if (m.fps) parts.push(`${m.fps}fps`);
  fileMeta.textContent = parts.join(' · ');
}

removeBtn.addEventListener('click', resetAll);

function resetAll() {
  currentJob = null;
  fileInput.value = '';
  if (preview.src) {
    URL.revokeObjectURL(preview.src);
    preview.src = '';
  }
  hide(settingsSection);
  hide(progressSection);
  hide(resultSection);
  show(uploadSection);
}

/* ---------- Method config ---------- */
const methodConfigs = {
  size: {
    label: 'Tamanho final',
    unit: 'MB',
    min: 1,
    max: 2000,
    default: 50,
    step: 1,
    hint: 'Digite o tamanho final desejado, em megabytes.',
  },
  percentage: {
    label: 'Porcentagem do original',
    unit: '%',
    min: 10,
    max: 95,
    default: 50,
    step: 5,
    hint: 'O vídeo final terá aproximadamente essa porcentagem do tamanho original.',
  },
  quality: {
    label: 'Qualidade (CRF)',
    unit: 'CRF',
    min: 18,
    max: 35,
    default: 23,
    step: 1,
    hint: 'Menor = melhor qualidade. 18-23 recomendado, 24-28 para arquivos menores.',
  },
  bitrate: {
    label: 'Bitrate de vídeo',
    unit: 'kbps',
    min: 200,
    max: 20000,
    default: 2000,
    step: 100,
    hint: 'Quanto maior o bitrate, melhor a qualidade e maior o arquivo.',
  },
};

function applyMethod(method) {
  const cfg = methodConfigs[method];
  valueLabel.textContent = cfg.label;
  valueUnit.textContent = cfg.unit;
  valueHint.textContent = cfg.hint;
  valueSlider.min = cfg.min;
  valueSlider.max = cfg.max;
  valueSlider.step = cfg.step;
  valueSlider.value = cfg.default;
  valueInput.min = cfg.min;
  valueInput.max = cfg.max;
  valueInput.step = cfg.step;
  valueInput.value = cfg.default;
}

methodEl.addEventListener('change', () => applyMethod(methodEl.value));
applyMethod(methodEl.value);

valueSlider.addEventListener('input', () => (valueInput.value = valueSlider.value));
valueInput.addEventListener('input', () => {
  const v = Math.max(+valueInput.min, Math.min(+valueInput.max, +valueInput.value || 0));
  valueSlider.value = v;
});

/* ---------- Compress ---------- */
compressBtn.addEventListener('click', async () => {
  if (!currentJob) return;
  const body = {
    jobId: currentJob.jobId,
    method: methodEl.value,
    value: valueInput.value,
    codec: codecEl.value,
    resolution: resolutionEl.value,
    audio: audioEl.value,
    preset: presetEl.value,
  };

  hide(settingsSection);
  show(progressSection);
  progressFill.style.width = '0%';
  progressPct.textContent = '0%';
  progressSub.textContent = 'Isso pode levar alguns minutos.';

  try {
    const res = await fetch('/api/compress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao iniciar');
    }
    const { compressId } = await res.json();
    streamProgress(compressId);
  } catch (err) {
    alert('Erro: ' + err.message);
    hide(progressSection);
    show(settingsSection);
  }
});

function streamProgress(compressId) {
  const es = new EventSource(`/api/progress/${compressId}`);
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.status === 'processing') {
      const pct = Math.round(data.progress);
      progressFill.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;
    } else if (data.status === 'done') {
      progressFill.style.width = '100%';
      progressPct.textContent = '100%';
      es.close();
      setTimeout(() => showResult(compressId, data), 400);
    } else if (data.status === 'error') {
      alert('Erro na compressão: ' + (data.error || 'desconhecido'));
      es.close();
      hide(progressSection);
      show(settingsSection);
    }
  };
  es.onerror = () => {
    es.close();
  };
}

function showResult(compressId, data) {
  hide(progressSection);
  show(resultSection);

  const orig = data.originalSize;
  const out = data.outputSize;
  originalSizeEl.textContent = formatBytes(orig);
  outputSizeEl.textContent = formatBytes(out);

  if (orig && out) {
    const saved = orig - out;
    const pct = Math.round((saved / orig) * 100);
    if (saved > 0) {
      savingsEl.textContent = `−${pct}% (${formatBytes(saved)} economizados)`;
      savingsEl.style.color = 'var(--success)';
    } else {
      savingsEl.textContent = `+${Math.abs(pct)}% (arquivo ficou maior)`;
      savingsEl.style.color = 'var(--text-muted)';
    }
  }

  downloadLink.href = `/api/download/${compressId}`;
  resultSub.textContent = 'Seu vídeo comprimido está pronto para download.';
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

restartBtn.addEventListener('click', resetAll);
