import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { importRecipePdf, type ImportPhase } from '../lib/importRecipe'

interface Job { name: string; phase: ImportPhase | 'waiting'; id?: string; error?: string }

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
  const qc = useQueryClient()

  async function start(files: File[]) {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) return
    const offset = jobs.length
    setJobs((j) => [...j, ...pdfs.map((f) => ({ name: f.name, phase: 'waiting' as const }))])
    const update = (i: number, patch: Partial<Job>) => setJobs((j) => j.map((x, k) => (k === offset + i ? { ...x, ...patch } : x)))
    // One after another: keeps the Claude calls and uploads gentle on a phone connection.
    for (let i = 0; i < pdfs.length; i++) {
      try {
        const id = await importRecipePdf(pdfs[i], (phase) => update(i, { phase }))
        update(i, { phase: 'done', id })
      } catch (e) {
        update(i, { phase: 'error', error: (e as Error).message })
      }
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['ingredient-names'] })
    }
  }

  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); start([...e.dataTransfer.files]) }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition ${dragging ? 'border-lime-700 bg-lime-50' : 'border-stone-300 bg-white'}`}
      >
        <span className="font-medium">Scan-PDFs hierher ziehen oder auswählen</span>
        <span className="text-sm text-stone-500">Ein PDF pro Karte, Vorder- und Rückseite (wie aus ScanSnap Home). Mehrere auf einmal gehen.</span>
        <input type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => { start([...(e.target.files ?? [])]); e.target.value = '' }} />
      </label>

      {jobs.length > 0 && (
        <ul className="divide-y divide-stone-200 rounded-2xl bg-white ring-1 ring-stone-200">
          {jobs.map((j, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{j.name}</span>
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
