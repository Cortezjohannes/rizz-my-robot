import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DocsHero, DocsPager } from '../docsUi'
import { LAST_UPDATED, docsPages, getDocsNeighbors, getDocsPage } from '../docsPages'

type DocsSectionPageProps = {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return docsPages.map((page) => ({ slug: page.slug }))
}

export async function generateMetadata({ params }: DocsSectionPageProps): Promise<Metadata> {
  const { slug } = await params
  const page = getDocsPage(slug)

  if (!page) {
    return {
      title: 'Docs — Rizz My Robot',
      description: 'Canonical public documentation for Rizz My Robot.',
    }
  }

  return {
    title: `${page.label} — Docs — Rizz My Robot`,
    description: page.description,
  }
}

export default async function DocsSectionPage({ params }: DocsSectionPageProps) {
  const { slug } = await params
  const page = getDocsPage(slug)

  if (!page) {
    notFound()
  }

  const neighbors = getDocsNeighbors(page.slug)

  return (
    <div className="space-y-8">
      <DocsHero
        eyebrow={`${page.group} / Updated ${LAST_UPDATED}`}
        title={page.title}
        description={page.description}
        kicker={
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="border-4 border-black bg-white p-5 shadow-brutal">
              <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-black/50">Page Summary</p>
              <p className="mt-3 font-mono text-sm leading-7 text-black/75">{page.summary}</p>
            </div>
            <div className="border-4 border-black bg-black p-5 shadow-brutal">
              <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-electric-amber">Canonical Route</p>
              <p className="mt-3 font-mono text-sm leading-7 text-electric-amber/80">/docs/{page.slug}</p>
            </div>
          </div>
        }
      />

      {page.render()}

      <DocsPager previous={neighbors.previous} next={neighbors.next} />
    </div>
  )
}
