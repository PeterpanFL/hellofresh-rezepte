import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { DuplicateFileError, ExtractionError, importRecipePdf, type ImportPhase } from '../lib/importRecipe'
import { importFromInbox, inboxDisplayName, listInbox } from '../lib/inbox'

interface Job { name: string; source: 'datei' | 'scan-ordner'; phase: ImportPhase | 'waiting'; id?: string; error?: string }
interface Task { name: string; source: Job['source']; run: (onPhase: (p: ImportPhase) => void) => Promise<string> }

const LABEL: Record<Job['phase'], string> = {
  waiting: 'wartet',
  render: 'Seiten werden gelesen',
  upload: 'Bilder werden hochgeladen',
  extract: 'Text wird erkannt',
  save: 'wird gespeichert',
  done: 'fertig',
  error: 'Fehler',
}

export default function Upload() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [dragging, setDragging] = useState(false)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const seenInbox = useRef(new Set<string>())
  const qc = useQueryClient()

  // Tasks run one after another: keeps the Claude calls and uploads gentle on a phone connection.
  function enqueue(tasks: Task[]) {
    if (!tasks.length) return
    let offset = 0
    setJobs((j) => {
      offset = j.length
      return [...j, ...tasks.map((t) => ({ name: t.name, source: t.source, phase: 'waiting' as const }))]
    })
    const update = (i: number, patch: Partial<Job>) => setJobs((j) => j.map((x, k) => (k === offset + i ? { ...x, ...patch } : x)))
    queue.current = queue.current.then(async () => {
      for (let i = 0; i < tasks.length; i++) {
        try {
          const id = await tasks[i].run((phase) => update(i, { phase }))
          update(i, { phase: 'done', id })
        } catch (e) {
          const id = e instanceof DuplicateFileError ? e.existingId : e instanceof ExtractionError ? e.recipeId : undefined
          update(i, { phase: 'error', error: (e as Error).message, id })
        }
        qc.invalidateQueries({ queryKey: ['recipes'] })
        qc.invalidateQueries({ queryKey: ['ingredient-names'] })
        qc.invalidateQueries({ queryKey: ['inbox'] })
      }
    })
  }

  function addFiles(files: File[]) {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    enqueue(pdfs.map((f) => ({ name: f.name, source: 'datei', run: (onPhase) => importRecipePdf(f, onPhase) })))
  }

  // Scans from the Mac folder land in the inbox; pick them up whenever this page is open.
  useEffect(() => {
    let stop = false
    async function check() {
      try {
        const paths = (await listInbox()).filter((p) => !seenInbox.current.has(p))
        if (stop) return
        paths.forEach((p) => seenInbox.current.add(p))
        enqueue(paths.map((p) => ({ name: inboxDisplayName(p), source: 'scan-ordner', run: (onPhase) => importFromInbox(p, onPhase) })))
      } catch { /* offline or not signed in: try again on the next tick */ }
    }
    check()
    const timer = setInterval(check, 30_000)
    return () => { stop = true; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles([...e.dataTransfer.files]) }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition ${dragging ? 'border-lime-700 bg-lime-50' : 'border-stone-300 bg-white'}`}
      >
        <span className="font-medium">Scan-PDFs hierher ziehen oder auswählen</span>
        <span className="text-sm text-stone-500">Ein PDF pro Karte, Vorder- und Rückseite (wie aus ScanSnap Home). Mehrere auf einmal gehen.</span>
        <input type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
      </label>
      <p className="text-xs text-stone-500">Scans aus dem Mac-Ordner werden automatisch verarbeitet, solange diese Seite offen ist.</p>

      {jobs.length > 0 && (
        <ul className="divide-y divide-stone-200 rounded-2xl bg-white ring-1 ring-stone-200">
          {jobs.map((j, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {j.name}
                {j.source === 'scan-ordner' && <span className="chip ml-2 bg-sky-100 text-sky-800">Scan-Ordner</span>}
              </span>
              <span className={j.phase === 'error' ? 'text-red-700' : j.phase === 'done' ? 'text-lime-800' : 'text-stone-500'}>
                {j.phase === 'error' ? j.error : LABEL[j.phase]}
              </span>
              {j.id && <Link to={`/rezept/${j.id}`} className="text-lime-800 underline">öffnen</Link>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
