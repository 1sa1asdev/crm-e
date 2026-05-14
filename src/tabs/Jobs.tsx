import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { useLang } from '../hooks/useLang'
import { uid } from '../utils'
import type { Application } from '../types'
import type { FilterView } from '../types'

const JOBS_API = 'https://jobsearch.api.jobtechdev.se/search'
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/

const GEO: Record<string, { region: string; municipalities: { label: string; code: string }[] }> = {
  '01': {
    region: 'Stockholms län',
    municipalities: [
      { label: 'Botkyrka', code: '0127' }, { label: 'Danderyd', code: '0162' },
      { label: 'Ekerö', code: '0125' }, { label: 'Haninge', code: '0136' },
      { label: 'Huddinge', code: '0126' }, { label: 'Järfälla', code: '0123' },
      { label: 'Lidingö', code: '0186' }, { label: 'Nacka', code: '0182' },
      { label: 'Norrtälje', code: '0188' }, { label: 'Nykvarn', code: '0140' },
      { label: 'Nynäshamn', code: '0139' }, { label: 'Salem', code: '0128' },
      { label: 'Sigtuna', code: '0191' }, { label: 'Sollentuna', code: '0163' },
      { label: 'Solna', code: '0184' }, { label: 'Stockholm', code: '0180' },
      { label: 'Sundbyberg', code: '0183' }, { label: 'Södertälje', code: '0181' },
      { label: 'Tyresö', code: '0138' }, { label: 'Täby', code: '0160' },
      { label: 'Upplands Väsby', code: '0114' }, { label: 'Upplands-Bro', code: '0139' },
      { label: 'Vallentuna', code: '0115' }, { label: 'Vaxholm', code: '0187' },
      { label: 'Värmdö', code: '0120' }, { label: 'Österåker', code: '0117' },
    ],
  },
  '03': {
    region: 'Uppsala län',
    municipalities: [
      { label: 'Enköping', code: '0360' }, { label: 'Heby', code: '0331' },
      { label: 'Håbo', code: '0305' }, { label: 'Knivsta', code: '0330' },
      { label: 'Tierp', code: '0360' }, { label: 'Uppsala', code: '0380' },
      { label: 'Älvkarleby', code: '0382' }, { label: 'Östhammar', code: '0381' },
    ],
  },
  '04': {
    region: 'Södermanlands län',
    municipalities: [
      { label: 'Eskilstuna', code: '0484' }, { label: 'Flen', code: '0483' },
      { label: 'Gnesta', code: '0481' }, { label: 'Katrineholm', code: '0480' },
      { label: 'Nyköping', code: '0480' }, { label: 'Oxelösund', code: '0482' },
      { label: 'Strängnäs', code: '0486' }, { label: 'Trosa', code: '0488' },
      { label: 'Vingåker', code: '0428' },
    ],
  },
  '05': {
    region: 'Östergötlands län',
    municipalities: [
      { label: 'Boxholm', code: '0582' }, { label: 'Finspång', code: '0562' },
      { label: 'Kinda', code: '0563' }, { label: 'Linköping', code: '0580' },
      { label: 'Mjölby', code: '0586' }, { label: 'Motala', code: '0583' },
      { label: 'Norrköping', code: '0581' }, { label: 'Söderköping', code: '0584' },
      { label: 'Vadstena', code: '0583' }, { label: 'Ydre', code: '0512' },
      { label: 'Åtvidaberg', code: '0561' }, { label: 'Ödeshög', code: '0513' },
    ],
  },
  '06': {
    region: 'Jönköpings län',
    municipalities: [
      { label: 'Aneby', code: '0610' }, { label: 'Eksjö', code: '0665' },
      { label: 'Gislaved', code: '0662' }, { label: 'Gnosjö', code: '0617' },
      { label: 'Habo', code: '0643' }, { label: 'Jönköping', code: '0680' },
      { label: 'Mullsjö', code: '0642' }, { label: 'Nässjö', code: '0682' },
      { label: 'Sävsjö', code: '0684' }, { label: 'Tranås', code: '0687' },
      { label: 'Vaggeryd', code: '0663' }, { label: 'Vetlanda', code: '0685' },
      { label: 'Värnamo', code: '0683' },
    ],
  },
  '07': {
    region: 'Kronobergs län',
    municipalities: [
      { label: 'Alvesta', code: '0764' }, { label: 'Lessebo', code: '0761' },
      { label: 'Ljungby', code: '0781' }, { label: 'Markaryd', code: '0767' },
      { label: 'Tingsryd', code: '0763' }, { label: 'Uppvidinge', code: '0760' },
      { label: 'Växjö', code: '0780' }, { label: 'Älmhult', code: '0765' },
    ],
  },
  '08': {
    region: 'Kalmar län',
    municipalities: [
      { label: 'Borgholm', code: '0821' }, { label: 'Emmaboda', code: '0862' },
      { label: 'Hultsfred', code: '0860' }, { label: 'Högsby', code: '0840' },
      { label: 'Kalmar', code: '0880' }, { label: 'Mönsterås', code: '0861' },
      { label: 'Mörbylånga', code: '0840' }, { label: 'Nybro', code: '0881' },
      { label: 'Oskarshamn', code: '0882' }, { label: 'Torsås', code: '0863' },
      { label: 'Vimmerby', code: '0884' }, { label: 'Västervik', code: '0883' },
    ],
  },
  '09': {
    region: 'Gotlands län',
    municipalities: [{ label: 'Gotland', code: '0980' }],
  },
  '10': {
    region: 'Blekinge län',
    municipalities: [
      { label: 'Karlshamn', code: '1083' }, { label: 'Karlskrona', code: '1080' },
      { label: 'Olofström', code: '1081' }, { label: 'Ronneby', code: '1082' },
      { label: 'Sölvesborg', code: '1084' },
    ],
  },
  '12': {
    region: 'Skåne län',
    municipalities: [
      { label: 'Bjuv', code: '1292' }, { label: 'Bromölla', code: '1272' },
      { label: 'Burlöv', code: '1214' }, { label: 'Båstad', code: '1260' },
      { label: 'Eslöv', code: '1285' }, { label: 'Helsingborg', code: '1283' },
      { label: 'Hässleholm', code: '1293' }, { label: 'Höganäs', code: '1284' },
      { label: 'Hörby', code: '1261' }, { label: 'Höör', code: '1263' },
      { label: 'Klippan', code: '1291' }, { label: 'Kristianstad', code: '1290' },
      { label: 'Kävlinge', code: '1223' }, { label: 'Landskrona', code: '1282' },
      { label: 'Lomma', code: '1262' }, { label: 'Lund', code: '1281' },
      { label: 'Malmö', code: '1280' }, { label: 'Osby', code: '1273' },
      { label: 'Perstorp', code: '1275' }, { label: 'Simrishamn', code: '1264' },
      { label: 'Sjöbo', code: '1264' }, { label: 'Skurup', code: '1265' },
      { label: 'Staffanstorp', code: '1230' }, { label: 'Svalöv', code: '1214' },
      { label: 'Svedala', code: '1230' }, { label: 'Tomelilla', code: '1265' },
      { label: 'Trelleborg', code: '1287' }, { label: 'Vellinge', code: '1233' },
      { label: 'Ystad', code: '1286' }, { label: 'Ängelholm', code: '1277' },
      { label: 'Åstorp', code: '1290' }, { label: 'Örkelljunga', code: '1276' },
      { label: 'Östra Göinge', code: '1272' },
    ],
  },
  '13': {
    region: 'Hallands län',
    municipalities: [
      { label: 'Falkenberg', code: '1382' }, { label: 'Halmstad', code: '1380' },
      { label: 'Hylte', code: '1315' }, { label: 'Kungsbacka', code: '1384' },
      { label: 'Laholm', code: '1381' }, { label: 'Varberg', code: '1383' },
    ],
  },
  '14': {
    region: 'Västra Götalands län',
    municipalities: [
      { label: 'Ale', code: '1440' }, { label: 'Alingsås', code: '1489' },
      { label: 'Bengtsfors', code: '1494' }, { label: 'Bollebygd', code: '1443' },
      { label: 'Borås', code: '1490' }, { label: 'Dals-Ed', code: '1491' },
      { label: 'Essunga', code: '1462' }, { label: 'Falköping', code: '1499' },
      { label: 'Färgelanda', code: '1452' }, { label: 'Grästorp', code: '1463' },
      { label: 'Gullspång', code: '1484' }, { label: 'Göteborg', code: '1480' },
      { label: 'Götene', code: '1471' }, { label: 'Herrljunga', code: '1443' },
      { label: 'Hjo', code: '1497' }, { label: 'Härryda', code: '1444' },
      { label: 'Karlsborg', code: '1472' }, { label: 'Kungälv', code: '1442' },
      { label: 'Lerum', code: '1441' }, { label: 'Lidköping', code: '1494' },
      { label: 'Lilla Edet', code: '1494' }, { label: 'Lysekil', code: '1484' },
      { label: 'Mariestad', code: '1470' }, { label: 'Mark', code: '1463' },
      { label: 'Mellerud', code: '1465' }, { label: 'Mölndal', code: '1481' },
      { label: 'Munkedal', code: '1430' }, { label: 'Orust', code: '1421' },
      { label: 'Partille', code: '1441' }, { label: 'Skara', code: '1495' },
      { label: 'Skövde', code: '1496' }, { label: 'Sotenäs', code: '1427' },
      { label: 'Stenungsund', code: '1415' }, { label: 'Strömstad', code: '1440' },
      { label: 'Svenljunga', code: '1491' }, { label: 'Tanum', code: '1435' },
      { label: 'Tibro', code: '1498' }, { label: 'Tidaholm', code: '1498' },
      { label: 'Tjörn', code: '1419' }, { label: 'Tranemo', code: '1492' },
      { label: 'Trollhättan', code: '1488' }, { label: 'Töreboda', code: '1473' },
      { label: 'Uddevalla', code: '1485' }, { label: 'Ulricehamn', code: '1491' },
      { label: 'Vara', code: '1470' }, { label: 'Vårgårda', code: '1443' },
      { label: 'Västra Götaland', code: '1497' }, { label: 'Öckerö', code: '1421' },
    ],
  },
  '17': {
    region: 'Värmlands län',
    municipalities: [
      { label: 'Arvika', code: '1784' }, { label: 'Eda', code: '1730' },
      { label: 'Filipstad', code: '1782' }, { label: 'Forshaga', code: '1763' },
      { label: 'Grums', code: '1764' }, { label: 'Hagfors', code: '1783' },
      { label: 'Hammarö', code: '1761' }, { label: 'Karlstad', code: '1780' },
      { label: 'Kil', code: '1715' }, { label: 'Kristinehamn', code: '1781' },
      { label: 'Munkfors', code: '1762' }, { label: 'Storfors', code: '1760' },
      { label: 'Sunne', code: '1785' }, { label: 'Säffle', code: '1785' },
      { label: 'Torsby', code: '1737' }, { label: 'Årjäng', code: '1737' },
    ],
  },
  '18': {
    region: 'Örebro län',
    municipalities: [
      { label: 'Askersund', code: '1880' }, { label: 'Degerfors', code: '1862' },
      { label: 'Hallsberg', code: '1861' }, { label: 'Hällefors', code: '1863' },
      { label: 'Karlskoga', code: '1883' }, { label: 'Kumla', code: '1880' },
      { label: 'Laxå', code: '1814' }, { label: 'Lekeberg', code: '1884' },
      { label: 'Lindesberg', code: '1882' }, { label: 'Ljusnarsberg', code: '1880' },
      { label: 'Nora', code: '1884' }, { label: 'Örebro', code: '1880' },
    ],
  },
  '19': {
    region: 'Västmanlands län',
    municipalities: [
      { label: 'Arboga', code: '1984' }, { label: 'Fagersta', code: '1980' },
      { label: 'Hallstahammar', code: '1981' }, { label: 'Kungsör', code: '1984' },
      { label: 'Köping', code: '1982' }, { label: 'Norberg', code: '1983' },
      { label: 'Sala', code: '1984' }, { label: 'Skinnskatteberg', code: '1904' },
      { label: 'Surahammar', code: '1904' }, { label: 'Västerås', code: '1980' },
    ],
  },
  '20': {
    region: 'Dalarnas län',
    municipalities: [
      { label: 'Avesta', code: '2034' }, { label: 'Borlänge', code: '2081' },
      { label: 'Falun', code: '2080' }, { label: 'Gagnef', code: '2026' },
      { label: 'Hedemora', code: '2082' }, { label: 'Leksand', code: '2029' },
      { label: 'Ludvika', code: '2082' }, { label: 'Malung-Sälen', code: '2023' },
      { label: 'Mora', code: '2062' }, { label: 'Orsa', code: '2034' },
      { label: 'Rättvik', code: '2029' }, { label: 'Smedjebacken', code: '2082' },
      { label: 'Vansbro', code: '2021' }, { label: 'Älvdalen', code: '2062' },
    ],
  },
  '21': {
    region: 'Gävleborgs län',
    municipalities: [
      { label: 'Bollnäs', code: '2183' }, { label: 'Gävle', code: '2180' },
      { label: 'Hofors', code: '2184' }, { label: 'Hudiksvall', code: '2184' },
      { label: 'Ljusdal', code: '2183' }, { label: 'Nordanstig', code: '2182' },
      { label: 'Ockelbo', code: '2182' }, { label: 'Ovanåker', code: '2183' },
      { label: 'Sandviken', code: '2181' }, { label: 'Söderhamn', code: '2182' },
    ],
  },
  '22': {
    region: 'Västernorrlands län',
    municipalities: [
      { label: 'Härnösand', code: '2280' }, { label: 'Kramfors', code: '2282' },
      { label: 'Sollefteå', code: '2283' }, { label: 'Sundsvall', code: '2281' },
      { label: 'Timrå', code: '2262' }, { label: 'Ånge', code: '2260' },
      { label: 'Örnsköldsvik', code: '2284' },
    ],
  },
  '23': {
    region: 'Jämtlands län',
    municipalities: [
      { label: 'Berg', code: '2309' }, { label: 'Bräcke', code: '2305' },
      { label: 'Härjedalen', code: '2361' }, { label: 'Krokom', code: '2309' },
      { label: 'Ragunda', code: '2303' }, { label: 'Strömsund', code: '2313' },
      { label: 'Åre', code: '2321' }, { label: 'Östersund', code: '2380' },
    ],
  },
  '24': {
    region: 'Västerbottens län',
    municipalities: [
      { label: 'Bjurholm', code: '2403' }, { label: 'Dorotea', code: '2425' },
      { label: 'Lycksele', code: '2481' }, { label: 'Malå', code: '2418' },
      { label: 'Nordmaling', code: '2417' }, { label: 'Norsjö', code: '2418' },
      { label: 'Robertsfors', code: '2403' }, { label: 'Skellefteå', code: '2482' },
      { label: 'Sorsele', code: '2422' }, { label: 'Storuman', code: '2421' },
      { label: 'Umeå', code: '2480' }, { label: 'Vilhelmina', code: '2425' },
      { label: 'Vindeln', code: '2404' }, { label: 'Vännäs', code: '2404' },
      { label: 'Åsele', code: '2423' },
    ],
  },
  '25': {
    region: 'Norrbottens län',
    municipalities: [
      { label: 'Arjeplog', code: '2506' }, { label: 'Arvidsjaur', code: '2505' },
      { label: 'Boden', code: '2582' }, { label: 'Gällivare', code: '2583' },
      { label: 'Haparanda', code: '2583' }, { label: 'Jokkmokk', code: '2513' },
      { label: 'Kalix', code: '2584' }, { label: 'Kiruna', code: '2584' },
      { label: 'Luleå', code: '2580' }, { label: 'Pajala', code: '2521' },
      { label: 'Piteå', code: '2581' }, { label: 'Älvsbyn', code: '2582' },
      { label: 'Överkalix', code: '2521' }, { label: 'Övertorneå', code: '2521' },
    ],
  },
}

interface JobHit {
  id: string
  headline: string
  employer?: { name: string }
  workplace_address?: { municipality?: string; region?: string }
  publication_date?: string
  application_deadline?: string
  description?: { text?: string; text_formatted?: string }
  application_details?: { email?: string; url?: string; information?: string }
  webpage_url?: string
  working_hours_type?: { label?: string }
  remote?: boolean
}

function filterByWorkHours(hits: JobHit[], workHours: string): JobHit[] {
  if (!workHours) return hits
  return hits.filter(h => {
    const label = (h.working_hours_type?.label ?? '').toLowerCase()
    if (!label) return true // no label set — keep rather than over-filter
    if (workHours === 'deltid') return !label.startsWith('heltid') || label.includes('deltid')
    if (workHours === 'heltid') return !label.startsWith('deltid') || label.includes('heltid')
    return true
  })
}

async function fetchPage(queries: string[], baseParams: URLSearchParams, perTag: number, offset: number, seen: Set<string>): Promise<JobHit[]> {
  const responses = await Promise.all(queries.map(tag => {
    const p = new URLSearchParams(baseParams)
    p.set('limit', String(perTag))
    p.set('offset', String(offset))
    if (tag) p.set('q', tag)
    return fetch(`${JOBS_API}?${p}`, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() as Promise<{ hits?: JobHit[] }> : { hits: [] })
  }))
  const merged: JobHit[] = []
  const lists = responses.map(d => d.hits || [])
  const maxLen = Math.max(...lists.map(l => l.length), 0)
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      const hit = list[i]
      if (hit && !seen.has(hit.id)) { seen.add(hit.id); merged.push(hit) }
    }
  }
  return merged
}

function extractEmail(hit: JobHit): string {
  if (hit.application_details?.email) return hit.application_details.email
  const text = [hit.description?.text, hit.description?.text_formatted, hit.application_details?.information].filter(Boolean).join(' ')
  const m = text.match(EMAIL_RE)
  return m ? m[0] : ''
}

export default function Jobs() {
  const { state, update, toast } = useStore()
  const { t } = useLang()
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)
  const [regionCode, setRegionCode] = useState('')
  const [municipalityCodes, setMunicipalityCodes] = useState<string[]>([])
  const [muniOpen, setMuniOpen] = useState(false)
  const muniRef = useRef<HTMLDivElement>(null)
  const [workHours, setWorkHours] = useState('')
  const [remote, setRemote] = useState(false)
  const [limit, setLimit] = useState('20')
  const [channelFilter, setChannelFilter] = useState<'all' | 'email' | 'external'>('all')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [meta, setMeta] = useState('')
  const [hits, setHits] = useState<JobHit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [targetViewId, setTargetViewId] = useState(() => state.active_view_id ?? '')
  const [newIntentionName, setNewIntentionName] = useState('')
  const newIntentionRef = useRef<HTMLInputElement>(null)
  const lastSearchRef = useRef<{ queries: string[]; baseParams: URLSearchParams; perTag: number; offset: number } | null>(null)

  const municipalities = regionCode ? GEO[regionCode]?.municipalities ?? [] : []

  const MAX_TAGS = 4

  function addTag(raw: string) {
    const val = raw.trim().replace(/,+$/, '').trim()
    if (!val) { setTagInput(''); return }
    if (tags.length >= MAX_TAGS) { toast(`Max ${MAX_TAGS} söktermer`, 'error'); setTagInput(''); return }
    if (!tags.includes(val)) setTags(prev => [...prev, val])
    setTagInput('')
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && tags.length) {
      setTags(prev => prev.slice(0, -1))
    }
  }

  function removeTag(tag: string) {
    setTags(prev => prev.filter(t => t !== tag))
  }

  function handleRegionChange(code: string) {
    setRegionCode(code)
    setMunicipalityCodes([])
  }

  function toggleMunicipality(code: string) {
    setMunicipalityCodes(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])
  }

  // Close municipality dropdown on outside click
  useEffect(() => {
    if (!muniOpen) return
    function onClick(e: MouseEvent) {
      if (muniRef.current && !muniRef.current.contains(e.target as Node)) setMuniOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [muniOpen])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const allTags = [...tags, ...(tagInput.trim() ? [tagInput.trim()] : [])]
    if (!allTags.length && !regionCode && !remote) { toast('Ange sökord eller välj en region', 'error'); return }
    setLoading(true)
    setMeta(t('jobs.searching'))
    setHits([])

    const baseParams = new URLSearchParams()
    if (municipalityCodes.length > 0) {
      // API accepts repeated `municipality` keys for multi-select
      for (const code of municipalityCodes) baseParams.append('municipality', code)
    } else if (regionCode) {
      baseParams.set('region', regionCode)
    }
    if (remote) baseParams.set('remote', 'true')
    if (workHours === 'heltid') baseParams.set('scope-of-work.min', '100')
    if (workHours === 'deltid') baseParams.set('scope-of-work.max', '99')

    const queries = allTags.length ? allTags : ['']
    const perTag = Math.max(10, Math.ceil(Number(limit) / queries.length))
    lastSearchRef.current = { queries, baseParams, perTag, offset: 0 }

    try {
      const merged = filterByWorkHours(await fetchPage(queries, baseParams, perTag, 0, new Set()), workHours)
      setHits(merged)
      setHasMore(merged.length >= perTag * queries.length)
      setMeta(t('jobs.results', { n: merged.length }))
    } catch (err) {
      setMeta('')
      toast(`Sökning misslyckades: ${(err as Error).message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!lastSearchRef.current) return
    const { queries, baseParams, perTag } = lastSearchRef.current
    lastSearchRef.current.offset += perTag
    const { offset } = lastSearchRef.current
    setLoadingMore(true)
    try {
      const existingIds = new Set(hits.map(h => h.id))
      const more = filterByWorkHours(await fetchPage(queries, baseParams, perTag, offset, existingIds), workHours)
      setHits(prev => [...prev, ...more])
      setHasMore(more.length >= perTag * queries.length)
      setMeta(t('jobs.results', { n: hits.length + more.length }))
    } catch (err) {
      toast(`Kunde inte ladda fler: ${(err as Error).message}`, 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  function createIntention() {
    const name = newIntentionName.trim()
    if (!name) return
    const view: FilterView = { id: uid('view'), name }
    update(s => { s.filter_views.push(view) })
    setTargetViewId(view.id)
    setNewIntentionName('')
    toast(`Avsikt "${name}" skapad`, 'success')
  }

  function unimportJob(hitId: string) {
    update(s => {
      s.applications = s.applications.filter(a => a.source_job_id !== hitId)
      s.imported_job_ids = s.imported_job_ids.filter(id => id !== hitId)
    })
  }

  function importJob(hit: JobHit) {
    const email = extractEmail(hit)
    const url = hit.application_details?.url || ''
    const base: Partial<Application> = {
      company: hit.employer?.name ?? '',
      role: hit.headline ?? '',
      status: 'draft',
      applied_at: '',
      last_contact_at: '',
      contact_name: '',
      contact_email: email,
      link: url || hit.webpage_url || '',
      deadline: hit.application_deadline ? hit.application_deadline.slice(0, 10) : undefined,
      notes: [
        `Importerad från Arbetsförmedlingen ${new Date().toISOString().slice(0, 10)}`,
        hit.workplace_address?.municipality ? `Ort: ${hit.workplace_address.municipality}` : '',
        '',
        (hit.description?.text || '').slice(0, 1200),
      ].filter(Boolean).join('\n'),
      source_job_id: hit.id,
    }
    update(s => {
      const newApp: Application = { ...base, id: uid('app'), created_at: new Date().toISOString() } as Application
      if (targetViewId) newApp.view_id = targetViewId
      s.applications.unshift(newApp)
      if (!s.imported_job_ids.includes(hit.id)) s.imported_job_ids.push(hit.id)
    })
    setHits(prev => [...prev])
    toast(email ? `Lade till "${base.company}" — e-post hittades` : `Lade till "${base.company}"`, 'success')
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3"><h2 className="m-0 text-base font-semibold">Hitta jobb</h2></div>
      <p className="text-lo text-[13px] m-0 mb-4">
        Sök via <strong>Arbetsförmedlingen</strong> (JobTech Dev API). Klicka <strong>+</strong> för att importera som ansökan.
      </p>
      <form className="grid grid-cols-[1fr_1fr_1fr_auto_auto_auto_auto] max-[900px]:grid-cols-2 gap-2 mb-3 items-center" onSubmit={search}>
        <div className="col-span-full flex flex-wrap items-center gap-1.5 px-2 py-[5px] bg-canvas border border-edge rounded-lg min-h-[36px] cursor-text focus-within:border-primary" onClick={() => tagInputRef.current?.focus()}>
          {tags.map(tag => (
            <span key={tag} className="tag-pill">
              {tag}
              <button type="button" onClick={e => { e.stopPropagation(); removeTag(tag) }}>×</button>
            </span>
          ))}
          {tags.length < MAX_TAGS && (
            <input
              ref={tagInputRef}
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => tagInput.trim() && addTag(tagInput)}
              placeholder={tags.length ? 'Lägg till fler…' : 'Yrkesroll, nyckelord… (Enter för att lägga till)'}
            />
          )}
        </div>
        <select value={regionCode} onChange={e => handleRegionChange(e.target.value)}>
          <option value="">Hela Sverige</option>
          {Object.entries(GEO).map(([code, { region }]) => (
            <option key={code} value={code}>{region}</option>
          ))}
        </select>
        <div ref={muniRef} className="relative">
          <button
            type="button"
            disabled={!regionCode}
            onClick={() => setMuniOpen(o => !o)}
            className="w-full text-left bg-canvas border border-edge rounded-lg px-3 py-[7px] text-[13px] text-hi disabled:opacity-50 hover:border-primary/60 transition-colors"
            style={{ minHeight: 34 }}
          >
            {!regionCode
              ? <span className="text-lo/60">—</span>
              : municipalityCodes.length === 0
                ? <span className="text-lo">Hela länet</span>
                : municipalityCodes.length === 1
                  ? municipalities.find(m => m.code === municipalityCodes[0])?.label ?? '1 kommun'
                  : `${municipalityCodes.length} kommuner valda`}
            <span className="float-right text-lo/60 text-xs ml-2">▾</span>
          </button>
          {muniOpen && regionCode && (
            <div className="absolute left-0 top-full mt-1 w-full min-w-[220px] bg-surface border border-edge rounded-lg shadow-lg z-20 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-edge bg-raised/30">
                <span className="text-[11px] text-lo">{municipalityCodes.length} av {municipalities.length} valda</span>
                <button type="button" className="ghost text-[11px] px-2 py-0.5" onClick={() => setMunicipalityCodes([])}>{t('jobs.clear')}</button>
              </div>
              <div className="max-h-[260px] overflow-y-auto p-1 flex flex-col gap-0.5">
                {municipalities.map(m => {
                  const selected = municipalityCodes.includes(m.code)
                  return (
                    <button
                      key={m.code + m.label}
                      type="button"
                      onClick={() => toggleMunicipality(m.code)}
                      className={`text-left px-2.5 py-1.5 rounded text-[12px] border-none cursor-pointer transition-colors ${
                        selected
                          ? 'bg-primary/20 text-primary font-medium'
                          : 'bg-transparent text-hi hover:bg-raised'
                      }`}
                    >
                      {selected && <span className="mr-1.5">✓</span>}
                      {m.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        <select value={workHours} onChange={e => setWorkHours(e.target.value)}>
          <option value="">Alla arbetstider</option>
          <option value="heltid">Heltid</option>
          <option value="deltid">Deltid</option>
        </select>
        <select value={channelFilter} onChange={e => setChannelFilter(e.target.value as 'all' | 'email' | 'external')} title="How to apply">
          <option value="all">{t('jobs.allChannels')}</option>
          <option value="email">{t('jobs.emailOnly')}</option>
          <option value="external">{t('jobs.externalOnly')}</option>
        </select>
        <label className="flex items-center gap-1.5 text-[13px] whitespace-nowrap cursor-pointer">
          <input type="checkbox" checked={remote} onChange={e => setRemote(e.target.checked)} style={{ width: 'auto' }} />
          Distans
        </label>
        <select value={limit} onChange={e => setLimit(e.target.value)}>
          <option value="20">20 träffar</option>
          <option value="50">50 träffar</option>
          <option value="100">100 träffar</option>
        </select>
        <select
          value={targetViewId === '__new__' ? '__new__' : targetViewId}
          onChange={e => {
            setTargetViewId(e.target.value)
            if (e.target.value === '__new__') setTimeout(() => newIntentionRef.current?.focus(), 0)
          }}
          title="Tilldela avsikt för importerade jobb"
        >
          <option value="">{t('jobs.noIntent')}</option>
          {state.filter_views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          <option value="__new__">{t('jobs.newIntent')}</option>
        </select>
        {targetViewId === '__new__' && (
          <input
            ref={newIntentionRef}
            value={newIntentionName}
            onChange={e => setNewIntentionName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createIntention() } if (e.key === 'Escape') { setTargetViewId(''); setNewIntentionName('') } }}
            placeholder="Avsiktens namn…"
            style={{ width: 140 }}
          />
        )}
        {targetViewId === '__new__' && newIntentionName.trim() && (
          <button type="button" onClick={createIntention}>{t('jobs.add')}</button>
        )}
        <button type="submit" className="primary" disabled={loading}>{loading ? t('jobs.searching') : t('jobs.search')}</button>
      </form>
      {meta && (
        <div className="text-lo text-xs mb-2.5 flex items-center gap-2 flex-wrap">
          <span>{meta}</span>
          {channelFilter !== 'all' && hits.length > 0 && (() => {
            const visible = hits.filter(h => {
              const hasEmail    = !!extractEmail(h)
              const hasExternal = !!h.application_details?.url
              if (channelFilter === 'email')    return hasEmail
              if (channelFilter === 'external') return hasExternal
              return true
            }).length
            return <span className="text-lo/60">{t('jobs.afterFilter', { n: visible })}</span>
          })()}
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3" style={{ marginTop: 12 }}>
        {hits.filter(hit => {
          if (channelFilter === 'all') return true
          const hasEmail    = !!extractEmail(hit)
          const hasExternal = !!hit.application_details?.url
          if (channelFilter === 'email')    return hasEmail
          if (channelFilter === 'external') return hasExternal
          return true
        }).map(hit => {
          const email = extractEmail(hit)
          const url = hit.application_details?.url || ''
          const imported = state.imported_job_ids.includes(hit.id)
          const city = hit.workplace_address?.municipality || hit.workplace_address?.region || ''
          const hours = hit.working_hours_type?.label
          const desc = (hit.description?.text || '').slice(0, 220)
          const date = hit.publication_date?.slice(0, 10)
          return (
            <div key={hit.id} className={`job-card ${imported ? 'imported' : ''}`}>
              <button
                className={imported
                  ? 'absolute top-[10px] right-[10px] w-[30px] h-[30px] p-0 text-lg leading-none rounded-full bg-danger/20 text-danger border-danger/50 font-bold'
                  : 'absolute top-[10px] right-[10px] w-[30px] h-[30px] p-0 text-lg leading-none rounded-full bg-primary text-[#08121c] border-primary font-bold'}
                title={imported ? 'Remove from applications' : 'Import to CRM'}
                onClick={() => imported ? unimportJob(hit.id) : importJob(hit)}
              >
                {imported ? '✕' : '+'}
              </button>
              <h3 className="m-0 font-semibold text-sm" style={{ paddingRight: 36, lineHeight: 1.35 }}>{hit.headline || '(utan titel)'}</h3>
              <div className="text-lo text-xs flex gap-2 flex-wrap">
                <span>{hit.employer?.name || '—'}</span>
                {city && <span>· {city}</span>}
                {hours && <span>· {hours}</span>}
                {hit.remote && <span>· Distans</span>}
                {date && <span>· {date}</span>}
              </div>
              <div className="text-xs text-lo max-h-[70px] overflow-hidden leading-[1.45]">{desc}{desc.length === 220 ? '…' : ''}</div>
              <div className="flex justify-between items-center gap-2 mt-auto pt-[6px]">
                <div className="flex gap-1 flex-wrap">
                  {email && <span className="job-chip email">✉ {email}</span>}
                  {url && <span className="job-chip ext-url">extern ansökan</span>}
                </div>
                {hit.webpage_url && <a href={hit.webpage_url} target="_blank" rel="noopener" className="job-chip">visa ↗</a>}
              </div>
            </div>
          )
        })}
      </div>
      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t('jobs.loading') : t('jobs.loadMore')}
          </button>
        </div>
      )}
    </div>
  )
}
