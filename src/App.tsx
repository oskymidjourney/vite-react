import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import './App.css'

type Segment = 'frio' | 'tibio' | 'caliente'

type Contact = {
  id: string
  number: string
  name: string
  company: string
  identification: string
  advisor: string
  selected: boolean
  valid: boolean
  segment: Segment
}

type GeneratedLink = {
  id: string
  number: string
  message: string
  url: string
}

type SenderState = 'idle' | 'running' | 'paused' | 'finished'

type Template = {
  id: string
  name: string
  category: string
  content: string
  updatedAt: string
}

type LogEntry = {
  timestamp: string
  number: string
  status: 'opened' | 'dry-run'
  url: string
}

type ColumnMapping = {
  company: string
  identification: string
  name: string
  number: string
  advisor: string
  segment: string
}

const DEFAULT_MESSAGE =
  'Estimado(a) {nombre}, aunque ya no estés en {empresa}, tu protección puede continuar. ¿Te cuento cómo mantener tus beneficios?'

const STORAGE_CONTACTS = 'wa_bulk_contacts_v2'
const STORAGE_TEMPLATES = 'wa_bulk_templates_v1'

const normalizePhone = (value: string) => {
  const raw = value.trim()
  const hasPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (hasPlus) return `+${digits}`
  if (digits.length === 10) return `+57${digits}`
  if (digits.length === 12 && digits.startsWith('57')) return `+${digits}`
  return `+${digits}`
}

const validatePhone = (value: string) => /^\+\d{8,16}$/.test(value)

const templateMsg = (tpl: string, c: Contact) =>
  tpl
    .replace(/\{nombre\}/g, c.name)
    .replace(/\{empresa\}/g, c.company)
    .replace(/\{identificacion\}/g, c.identification)
    .replace(/\{asesor\}/g, c.advisor)
    .replace(/\{segmento\}/g, c.segment)

const parseSegment = (value: string): Segment => {
  const normalized = value.toLowerCase().trim()
  if (normalized.includes('cal')) return 'caliente'
  if (normalized.includes('tib')) return 'tibio'
  return 'frio'
}

const csvEscape = (value: string) => `"${String(value).replace(/"/g, '""')}"`

function App() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [single, setSingle] = useState({ number: '', name: '', company: '', segment: 'frio' as Segment })
  const [bulkText, setBulkText] = useState('')
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_MESSAGE)
  const [links, setLinks] = useState<GeneratedLink[]>([])
  const [alert, setAlert] = useState<string>('')
  const [batchSize, setBatchSize] = useState(50)
  const [intervalSeconds, setIntervalSeconds] = useState(12)
  const [jitterSeconds, setJitterSeconds] = useState(3)
  const [senderState, setSenderState] = useState<SenderState>('idle')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [dryRun, setDryRun] = useState(false)
  const [segmentFilter, setSegmentFilter] = useState<'todos' | Segment>('todos')
  const [advancedFilter, setAdvancedFilter] = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateName, setTemplateName] = useState('')
  const [templateCategory, setTemplateCategory] = useState('general')
  const [previewContactId, setPreviewContactId] = useState('')
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [antiBlockEnabled, setAntiBlockEnabled] = useState(true)
  const [longPauseEveryBatches, setLongPauseEveryBatches] = useState(2)
  const [longPauseSeconds, setLongPauseSeconds] = useState(45)

  const [importHeaders, setImportHeaders] = useState<string[]>([])
  const [importRows, setImportRows] = useState<string[][]>([])
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    company: '',
    identification: '',
    name: '',
    number: '',
    advisor: '',
    segment: '',
  })

  const queueRef = useRef<GeneratedLink[]>([])
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const savedContacts = localStorage.getItem(STORAGE_CONTACTS)
    if (savedContacts) {
      try {
        setContacts(JSON.parse(savedContacts) as Contact[])
      } catch {
        setAlert('No se pudieron recuperar contactos guardados.')
      }
    }

    const savedTemplates = localStorage.getItem(STORAGE_TEMPLATES)
    if (savedTemplates) {
      try {
        setTemplates(JSON.parse(savedTemplates) as Template[])
      } catch {
        setAlert('No se pudieron recuperar plantillas guardadas.')
      }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_CONTACTS, JSON.stringify(contacts))
  }, [contacts])

  useEffect(() => {
    localStorage.setItem(STORAGE_TEMPLATES, JSON.stringify(templates))
  }, [templates])

  const filteredContacts = useMemo(() => {
    const query = advancedFilter.toLowerCase().trim()
    return contacts.filter((c) => {
      if (segmentFilter !== 'todos' && c.segment !== segmentFilter) return false
      if (!query) return true
      const haystack = `${c.name} ${c.company} ${c.identification} ${c.number} ${c.advisor}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [contacts, segmentFilter, advancedFilter])

  const stats = useMemo(() => {
    const total = filteredContacts.length
    const selected = filteredContacts.filter((c) => c.selected).length
    const valid = filteredContacts.filter((c) => c.valid).length
    return { total, selected, valid }
  }, [filteredContacts])

  const selectedContacts = useMemo(() => contacts.filter((c) => c.selected && c.valid), [contacts])
  const previewContact = useMemo(() => contacts.find((c) => c.id === previewContactId) ?? selectedContacts[0], [contacts, previewContactId, selectedContacts])

  const upsertContact = (incoming: Omit<Contact, 'id' | 'selected'>) => {
    setContacts((prev) => {
      if (prev.some((c) => c.number === incoming.number)) return prev
      return [...prev, { ...incoming, id: crypto.randomUUID(), selected: incoming.valid }]
    })
  }

  const handleAddSingle = () => {
    const normalized = normalizePhone(single.number)
    const valid = validatePhone(normalized)
    if (!normalized || !valid) {
      setAlert('Número inválido. Ejemplo: 3001234567 o +573001234567.')
      return
    }

    upsertContact({
      number: normalized,
      name: single.name.trim(),
      company: single.company.trim(),
      identification: '',
      advisor: '',
      valid,
      segment: single.segment,
    })

    setSingle({ number: '', name: '', company: '', segment: single.segment })
    setAlert('Contacto agregado.')
  }

  const handleBulkTextImport = () => {
    const rows = bulkText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [company = '', identification = '', name = '', number = '', advisor = '', segment = 'frio'] = line
          .split('|')
          .map((col) => col.trim())
        const normalized = normalizePhone(number)
        return {
          company,
          identification,
          name,
          advisor,
          number: normalized,
          valid: validatePhone(normalized),
          segment: parseSegment(segment),
        }
      })

    if (!rows.length) {
      setAlert('No hay datos para importar.')
      return
    }

    rows.forEach((row) => {
      if (!row.valid) return
      upsertContact({
        number: row.number,
        name: row.name,
        company: row.company,
        identification: row.identification,
        advisor: row.advisor,
        valid: row.valid,
        segment: row.segment,
      })
    })

    setBulkText('')
    setAlert(`Importación texto completada: ${rows.filter((r) => r.valid).length} válidos detectados.`)
  }

  const inferColumnMapping = (headers: string[]): ColumnMapping => {
    const findBy = (terms: string[]) =>
      headers.find((h) => terms.some((t) => h.toLowerCase().includes(t))) ?? ''

    return {
      company: findBy(['empresa', 'company']),
      identification: findBy(['identificacion', 'documento', 'cedula', 'id']),
      name: findBy(['beneficiario', 'nombre', 'name']),
      number: findBy(['celular', 'telefono', 'movil', 'phone']),
      advisor: findBy(['asesor', 'advisor']),
      segment: findBy(['segmento', 'segment']),
    }
  }

  const parseCsvText = (text: string) => {
    const lines = text.split(/\r?\n/).filter(Boolean)
    if (!lines.length) return { headers: [] as string[], rows: [] as string[][] }
    const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ','
    const rows = lines.map((line) => line.split(delimiter).map((c) => c.trim()))
    const headers = rows[0]
    return { headers, rows: rows.slice(1) }
  }

  const handleFileImport = async (file: File) => {
    const ext = file.name.toLowerCase()
    if (ext.endsWith('.csv')) {
      const text = await file.text()
      const { headers, rows } = parseCsvText(text)
      setImportHeaders(headers)
      setImportRows(rows)
      setColumnMapping(inferColumnMapping(headers))
      setAlert(`CSV cargado (${rows.length} filas). Ajusta mapeo y confirma.`)
      return
    }

    if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data)
      const sheetName = wb.SheetNames[0]
      const sheet = wb.Sheets[sheetName]
      const matrix = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, blankrows: false })
      if (!matrix.length) {
        setAlert('Archivo Excel vacío.')
        return
      }
      const headers = matrix[0].map((cell) => String(cell ?? '').trim())
      const rows = matrix.slice(1).map((row) => headers.map((_, i) => String(row[i] ?? '').trim()))
      setImportHeaders(headers)
      setImportRows(rows)
      setColumnMapping(inferColumnMapping(headers))
      setAlert(`Excel cargado (${rows.length} filas). Ajusta mapeo y confirma.`)
      return
    }

    setAlert('Formato no soportado. Usa CSV/XLSX/XLS.')
  }

  const importMappedRows = () => {
    if (!importRows.length) {
      setAlert('No hay filas cargadas.')
      return
    }
    if (!columnMapping.number) {
      setAlert('Debes mapear la columna de celular.')
      return
    }

    const colIndex = (name: string) => importHeaders.findIndex((h) => h === name)
    const indexMap = {
      company: colIndex(columnMapping.company),
      identification: colIndex(columnMapping.identification),
      name: colIndex(columnMapping.name),
      number: colIndex(columnMapping.number),
      advisor: colIndex(columnMapping.advisor),
      segment: colIndex(columnMapping.segment),
    }

    let validCount = 0
    importRows.forEach((row) => {
      const rawNumber = row[indexMap.number] ?? ''
      const normalized = normalizePhone(rawNumber)
      const valid = validatePhone(normalized)
      if (!valid) return
      validCount += 1
      upsertContact({
        number: normalized,
        name: indexMap.name >= 0 ? row[indexMap.name] : '',
        company: indexMap.company >= 0 ? row[indexMap.company] : '',
        identification: indexMap.identification >= 0 ? row[indexMap.identification] : '',
        advisor: indexMap.advisor >= 0 ? row[indexMap.advisor] : '',
        valid,
        segment: parseSegment(indexMap.segment >= 0 ? row[indexMap.segment] : ''),
      })
    })

    setAlert(`Importación asistida completada. Filas válidas: ${validCount}.`)
    setImportRows([])
    setImportHeaders([])
  }

  const generateLinks = () => {
    if (!selectedContacts.length) {
      setAlert('Selecciona al menos un contacto válido.')
      return
    }

    const generated = selectedContacts.map((c) => {
      const phoneDigits = c.number.replace(/\D/g, '')
      const message = templateMsg(messageTemplate, c)
      return {
        id: c.id,
        number: c.number,
        message,
        url: `https://web.whatsapp.com/send?phone=${phoneDigits}&text=${encodeURIComponent(message)}`,
      }
    })

    setLinks(generated)
    setAlert(`Se generaron ${generated.length} enlaces.`)
  }

  const copyLinks = async () => {
    if (!links.length) return
    try {
      await navigator.clipboard.writeText(links.map((l) => l.url).join('\n'))
      setAlert('Enlaces copiados al portapapeles.')
    } catch {
      setAlert('No se pudo copiar al portapapeles.')
    }
  }

  const exportLogCsv = () => {
    if (!logEntries.length) {
      setAlert('No hay bitácora para exportar.')
      return
    }

    const header = 'timestamp,number,status,url'
    const rows = logEntries.map((entry) =>
      [entry.timestamp, entry.number, entry.status, entry.url].map(csvEscape).join(','),
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bitacora-whatsapp-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const saveTemplateVersion = () => {
    const content = messageTemplate.trim()
    const name = templateName.trim()
    if (!name || !content) {
      setAlert('Debes indicar nombre de plantilla y contenido.')
      return
    }

    const newTemplate: Template = {
      id: crypto.randomUUID(),
      name,
      category: templateCategory.trim() || 'general',
      content,
      updatedAt: new Date().toLocaleString('es-CO'),
    }

    setTemplates((prev) => [newTemplate, ...prev])
    setTemplateName('')
    setAlert('Plantilla versionada guardada.')
  }

  const loadTemplateVersion = (template: Template) => {
    setMessageTemplate(template.content)
    setAlert(`Plantilla "${template.name}" cargada.`)
  }

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const registerLog = (entry: LogEntry) => {
    setLogEntries((prev) => [entry, ...prev].slice(0, 600))
  }

  const runSender = (fromIndex = 0) => {
    const queue = queueRef.current
    if (fromIndex >= queue.length) {
      setSenderState('finished')
      setCurrentIndex(queue.length)
      setAlert('Proceso completado.')
      return
    }

    setCurrentIndex(fromIndex + 1)
    const current = queue[fromIndex]

    if (dryRun) {
      registerLog({
        timestamp: new Date().toISOString(),
        number: current.number,
        status: 'dry-run',
        url: current.url,
      })
    } else {
      window.open(current.url, '_blank', 'noopener,noreferrer')
      registerLog({
        timestamp: new Date().toISOString(),
        number: current.number,
        status: 'opened',
        url: current.url,
      })
    }

    const base = Math.max(1, intervalSeconds)
    const jitter = Math.floor(Math.random() * (Math.max(0, jitterSeconds) + 1))
    const nextIndex = fromIndex + 1
    let wait = (base + jitter) * 1000

    const nextBatchNumber = Math.floor(nextIndex / Math.max(1, batchSize))
    const atBatchBoundary = nextIndex > 0 && nextIndex % Math.max(1, batchSize) === 0
    if (
      antiBlockEnabled &&
      atBatchBoundary &&
      longPauseEveryBatches > 0 &&
      nextBatchNumber > 0 &&
      nextBatchNumber % longPauseEveryBatches === 0
    ) {
      wait += Math.max(1, longPauseSeconds) * 1000
      setAlert(`Pausa anti-bloqueo aplicada (${longPauseSeconds}s).`)
    }

    timerRef.current = window.setTimeout(() => runSender(nextIndex), wait)
  }

  const startSender = () => {
    if (!links.length) {
      setAlert('Primero debes generar enlaces.')
      return
    }
    stopTimer()
    queueRef.current = links
    setSenderState('running')
    setCurrentIndex(0)
    runSender(0)
  }

  const pauseSender = () => {
    stopTimer()
    setSenderState('paused')
  }

  const resumeSender = () => {
    setSenderState('running')
    runSender(currentIndex)
  }

  const cancelSender = () => {
    stopTimer()
    setSenderState('idle')
    setCurrentIndex(0)
    setAlert('Envío cancelado.')
  }

  useEffect(() => () => stopTimer(), [])

  return (
    <main className="app">
      <header>
        <h1>💬 Mensajes Masivos WhatsApp PRO</h1>
        <p>Importación asistida, plantillas versionadas, dry-run, segmentación y bitácora exportable.</p>
      </header>

      {alert && <div className="alert">{alert}</div>}

      <section className="grid">
        <article className="card">
          <h2>Contactos</h2>
          <div className="row">
            <input
              placeholder="Celular"
              value={single.number}
              onChange={(e) => setSingle((s) => ({ ...s, number: e.target.value }))}
            />
            <input
              placeholder="Nombre"
              value={single.name}
              onChange={(e) => setSingle((s) => ({ ...s, name: e.target.value }))}
            />
            <input
              placeholder="Empresa"
              value={single.company}
              onChange={(e) => setSingle((s) => ({ ...s, company: e.target.value }))}
            />
            <select value={single.segment} onChange={(e) => setSingle((s) => ({ ...s, segment: e.target.value as Segment }))}>
              <option value="frio">Frío</option>
              <option value="tibio">Tibio</option>
              <option value="caliente">Caliente</option>
            </select>
            <button onClick={handleAddSingle}>Agregar</button>
          </div>

          <textarea
            rows={5}
            placeholder="Empresa | Identificación | Beneficiario | Celular | Asesor | Segmento"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <div className="row compact">
            <button onClick={handleBulkTextImport}>Importar texto</button>
            <label className="file-input">
              CSV/XLSX
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFileImport(file)
                }}
              />
            </label>
          </div>

          {importHeaders.length > 0 && (
            <div className="mapper">
              <h3>Mapeo asistido de columnas</h3>
              <div className="mapping-grid">
                {(
                  [
                    ['company', 'Empresa'],
                    ['identification', 'Identificación'],
                    ['name', 'Beneficiario'],
                    ['number', 'Celular'],
                    ['advisor', 'Asesor'],
                    ['segment', 'Segmento'],
                  ] as Array<[keyof ColumnMapping, string]>
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <select
                      value={columnMapping[key]}
                      onChange={(e) => setColumnMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                    >
                      <option value="">Sin mapear</option>
                      {importHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button onClick={importMappedRows}>Confirmar importación asistida</button>
            </div>
          )}

          <div className="row compact">
            <label>
              Segmento
              <select value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value as 'todos' | Segment)}>
                <option value="todos">Todos</option>
                <option value="frio">Frío</option>
                <option value="tibio">Tibio</option>
                <option value="caliente">Caliente</option>
              </select>
            </label>
            <label>
              Buscar
              <input value={advancedFilter} onChange={(e) => setAdvancedFilter(e.target.value)} placeholder="nombre, empresa..." />
            </label>
          </div>

          <div className="stats">
            <span>Total: {stats.total}</span>
            <span>Válidos: {stats.valid}</span>
            <span>Seleccionados: {stats.selected}</span>
          </div>

          <ul className="list">
            {filteredContacts.map((c) => (
              <li key={c.id} className={!c.valid ? 'invalid' : ''}>
                <input
                  type="checkbox"
                  checked={c.selected}
                  onChange={(e) =>
                    setContacts((prev) => prev.map((item) => (item.id === c.id ? { ...item, selected: e.target.checked } : item)))
                  }
                />
                <span>
                  <strong>{c.number}</strong> · {c.name || 'Sin nombre'} · {c.company || 'Sin empresa'} · [{c.segment}]
                </span>
                <button onClick={() => setContacts((prev) => prev.filter((item) => item.id !== c.id))}>x</button>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Plantilla + Envío</h2>
          <textarea value={messageTemplate} onChange={(e) => setMessageTemplate(e.target.value)} rows={6} />
          <small>Variables: {'{nombre}'} {'{empresa}'} {'{identificacion}'} {'{asesor}'} {'{segmento}'}</small>

          <div className="row compact">
            <input placeholder="Nombre versión" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            <input placeholder="Categoría" value={templateCategory} onChange={(e) => setTemplateCategory(e.target.value)} />
            <button onClick={saveTemplateVersion}>Guardar versión</button>
          </div>

          <ul className="template-list">
            {templates.map((template) => (
              <li key={template.id}>
                <span>
                  <strong>{template.name}</strong> ({template.category}) · {template.updatedAt}
                </span>
                <button onClick={() => loadTemplateVersion(template)}>Cargar</button>
              </li>
            ))}
          </ul>

          <div className="preview-box">
            <label>
              Vista previa por contacto
              <select value={previewContact?.id ?? ''} onChange={(e) => setPreviewContactId(e.target.value)}>
                {selectedContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.number}
                  </option>
                ))}
              </select>
            </label>
            <pre>{previewContact ? templateMsg(messageTemplate, previewContact) : 'Selecciona contactos para vista previa.'}</pre>
          </div>

          <div className="row compact">
            <button onClick={generateLinks}>Generar enlaces</button>
            <button onClick={copyLinks} disabled={!links.length}>
              Copiar enlaces
            </button>
          </div>

          <div className="row compact">
            <label>
              Lote
              <input type="number" value={batchSize} min={1} onChange={(e) => setBatchSize(Number(e.target.value) || 1)} />
            </label>
            <label>
              Intervalo (s)
              <input
                type="number"
                value={intervalSeconds}
                min={1}
                onChange={(e) => setIntervalSeconds(Number(e.target.value) || 1)}
              />
            </label>
            <label>
              Jitter (s)
              <input type="number" value={jitterSeconds} min={0} onChange={(e) => setJitterSeconds(Number(e.target.value) || 0)} />
            </label>
          </div>

          <div className="row compact">
            <label>
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Dry-run (simulación)
            </label>
            <label>
              <input type="checkbox" checked={antiBlockEnabled} onChange={(e) => setAntiBlockEnabled(e.target.checked)} /> Anti-bloqueo
            </label>
            <label>
              Pausa cada N lotes
              <input
                type="number"
                value={longPauseEveryBatches}
                min={1}
                onChange={(e) => setLongPauseEveryBatches(Number(e.target.value) || 1)}
                disabled={!antiBlockEnabled}
              />
            </label>
            <label>
              Pausa larga (s)
              <input
                type="number"
                value={longPauseSeconds}
                min={5}
                onChange={(e) => setLongPauseSeconds(Number(e.target.value) || 5)}
                disabled={!antiBlockEnabled}
              />
            </label>
          </div>

          <div className="row compact">
            {senderState !== 'running' && <button onClick={startSender}>{dryRun ? 'Iniciar simulación' : 'Iniciar'}</button>}
            {senderState === 'running' && <button onClick={pauseSender}>Pausar</button>}
            {senderState === 'paused' && <button onClick={resumeSender}>Reanudar</button>}
            {(senderState === 'paused' || senderState === 'running') && <button onClick={cancelSender}>Cancelar</button>}
            <span>
              Estado: {senderState} · {currentIndex}/{links.length}
            </span>
          </div>

          <div className="row compact">
            <button onClick={exportLogCsv} disabled={!logEntries.length}>
              Exportar bitácora CSV
            </button>
          </div>

          <ol className="list links">
            {links.map((l) => (
              <li key={l.id}>
                <span>{l.number}</span>
                <a href={l.url} target="_blank" rel="noreferrer">
                  Abrir
                </a>
              </li>
            ))}
          </ol>

          <div className="log-box">
            {logEntries.length === 0 && <p>Sin actividad.</p>}
            {logEntries.slice(0, 40).map((entry, i) => (
              <p key={`${entry.timestamp}-${i}`}>
                [{entry.timestamp}] {entry.status.toUpperCase()} - {entry.number}
              </p>
            ))}
          </div>
        </article>
      </section>
    </main>
  )
}

export default App
