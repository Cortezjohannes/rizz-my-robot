import Link from 'next/link'
import type { ReactNode } from 'react'

type EndpointRow = {
  method: string
  path: string
  description: string
  notes?: string
}

type EndpointGroup = {
  title: string
  summary: string
  rows: EndpointRow[]
}

const methodStyles: Record<string, string> = {
  GET: 'bg-park-sky text-black',
  POST: 'bg-electric-lime text-black',
  PUT: 'bg-electric-amber text-black',
  PATCH: 'bg-electric-violet text-white',
  DELETE: 'bg-electric-magenta text-white',
}

function methodClass(method: string) {
  return methodStyles[method] ?? 'bg-white text-black'
}

export function DocsHero({
  eyebrow,
  title,
  description,
  kicker,
}: {
  eyebrow: string
  title: string
  description: string
  kicker?: ReactNode
}) {
  return (
    <section className="border-4 border-black bg-electric-amber shadow-brutal-xl">
      <div className="border-b-4 border-black px-6 py-6 sm:px-8">
        <p className="font-pixel text-[8px] uppercase tracking-[0.25em] text-black/55">{eyebrow}</p>
        <h1 className="mt-3 font-pixel text-lg leading-snug text-black sm:text-2xl">{title}</h1>
        <p className="mt-5 max-w-4xl font-mono text-sm leading-7 text-black/80">{description}</p>
      </div>
      {kicker ? <div className="px-6 py-5 sm:px-8">{kicker}</div> : null}
    </section>
  )
}

export function DocsSectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="border-4 border-black bg-white shadow-brutal-xl">
      <div className="border-b-4 border-black bg-[#fff5dc] px-6 py-5">
        <h2 className="font-pixel text-[10px] uppercase tracking-[0.2em] text-black">{title}</h2>
        {description ? <p className="mt-3 max-w-4xl font-mono text-sm text-black/70">{description}</p> : null}
      </div>
      <div className="p-6 sm:p-7">{children}</div>
    </section>
  )
}

export function CodeBlock({
  title,
  code,
  hint,
}: {
  title: string
  code: string
  hint?: string
}) {
  return (
    <div className="overflow-hidden border-4 border-black bg-black shadow-brutal">
      <div className="border-b-4 border-black bg-electric-amber px-4 py-3">
        <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-black">{title}</p>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-electric-lime">
        <code>{code}</code>
      </pre>
      {hint ? (
        <div className="border-t-4 border-black bg-black px-4 py-3 font-mono text-xs text-electric-amber/80">
          {hint}
        </div>
      ) : null}
    </div>
  )
}

export function SimpleTable({
  headers,
  rows,
}: {
  headers: readonly string[]
  rows: readonly ReactNode[][]
}) {
  return (
    <div className="overflow-x-auto border-4 border-black bg-white shadow-brutal">
      <table className="min-w-full border-collapse">
        <thead className="bg-black text-electric-amber">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className="border-b-4 border-black px-4 py-3 text-left font-pixel text-[8px] uppercase tracking-[0.2em]"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="align-top">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="border-t-2 border-black px-4 py-4 font-mono text-sm leading-6 text-black/80"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function EndpointTable({ group }: { group: EndpointGroup }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-pixel text-[10px] uppercase tracking-[0.2em] text-black">{group.title}</h3>
        <p className="mt-2 font-mono text-sm text-black/70">{group.summary}</p>
      </div>
      <SimpleTable
        headers={['Method', 'Path', 'Description']}
        rows={group.rows.map((row) => [
          <span
            key={`${row.method}-${row.path}`}
            className={`inline-flex rounded-none border-2 border-black px-2 py-1 font-pixel text-[8px] uppercase tracking-[0.18em] ${methodClass(row.method)}`}
          >
            {row.method}
          </span>,
          <div key={`${row.path}-path`} className="space-y-2">
            <code className="block text-[13px] font-bold text-black">{row.path}</code>
            {row.notes ? <p className="text-xs text-black/60">{row.notes}</p> : null}
          </div>,
          <span key={`${row.path}-description`}>{row.description}</span>,
        ])}
      />
    </div>
  )
}

export function Callout({
  tone = 'light',
  title,
  children,
}: {
  tone?: 'light' | 'dark'
  title: string
  children: ReactNode
}) {
  if (tone === 'dark') {
    return (
      <div className="border-4 border-black bg-black p-5 shadow-brutal">
        <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-electric-amber">{title}</p>
        <div className="mt-3 font-mono text-sm leading-7 text-electric-amber/80">{children}</div>
      </div>
    )
  }

  return (
    <div className="border-4 border-black bg-[#fff5dc] p-5 shadow-brutal">
      <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-black/50">{title}</p>
      <div className="mt-3 font-mono text-sm leading-7 text-black/75">{children}</div>
    </div>
  )
}

export function DocsBulletList({
  items,
}: {
  items: readonly ReactNode[]
}) {
  return (
    <ul className="space-y-3 font-mono text-sm leading-7 text-black/75">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span className="mt-2 h-2.5 w-2.5 shrink-0 border-2 border-black bg-electric-lime" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function DocsCardGrid({
  items,
}: {
  items: readonly { title: string; body: ReactNode }[]
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.title} className="border-4 border-black bg-white p-4 shadow-brutal">
          <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-black">{item.title}</p>
          <div className="mt-3 font-mono text-sm leading-6 text-black/75">{item.body}</div>
        </div>
      ))}
    </div>
  )
}

export function DocsTimeline({
  steps,
}: {
  steps: readonly { title: string; body: ReactNode }[]
}) {
  return (
    <div className="space-y-4">
      {steps.map((step, index) => (
        <div key={step.title} className="grid gap-3 md:grid-cols-[56px_minmax(0,1fr)]">
          <div className="flex items-start md:justify-center">
            <div className="flex h-12 w-12 items-center justify-center border-4 border-black bg-electric-lime shadow-brutal">
              <span className="font-pixel text-[10px] text-black">{index + 1}</span>
            </div>
          </div>
          <div className="border-4 border-black bg-white p-4 shadow-brutal">
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-black">{step.title}</p>
            <div className="mt-3 font-mono text-sm leading-7 text-black/75">{step.body}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function DocsFaq({
  items,
}: {
  items: readonly { question: string; answer: ReactNode }[]
}) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.question} className="border-4 border-black bg-white shadow-brutal">
          <div className="border-b-4 border-black bg-[#fff5dc] px-5 py-4">
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-black">{item.question}</p>
          </div>
          <div className="px-5 py-4 font-mono text-sm leading-7 text-black/75">{item.answer}</div>
        </div>
      ))}
    </div>
  )
}

export function DocsPager({
  previous,
  next,
}: {
  previous?: { href: string; label: string } | null
  next?: { href: string; label: string } | null
}) {
  if (!previous && !next) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {previous ? (
        <Link
          href={previous.href}
          className="border-4 border-black bg-white p-5 shadow-brutal hover:bg-beige-light"
        >
          <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-black/50">Previous</p>
          <p className="mt-3 font-pixel text-[9px] uppercase tracking-[0.16em] text-black">{previous.label}</p>
        </Link>
      ) : <div />}
      {next ? (
        <Link
          href={next.href}
          className="border-4 border-black bg-white p-5 text-left shadow-brutal hover:bg-beige-light sm:justify-self-end"
        >
          <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-black/50">Next</p>
          <p className="mt-3 font-pixel text-[9px] uppercase tracking-[0.16em] text-black">{next.label}</p>
        </Link>
      ) : null}
    </div>
  )
}
