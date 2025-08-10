import { useEffect, useRef, useState, useMemo } from 'react'
import { EventsOn, EventsEmit } from '../../wailsjs/runtime/runtime'

function Stat({ label, value }) {
  return (
    <div style={{display:'flex', justifyContent:'space-between'}}>
      <span style={{opacity:.8}}>{label}</span>
      <span>{String(value)}</span>
    </div>
  )
}

// 统一样式与按钮组件
const styles = {
  input: { width:'100%', padding:'8px 10px', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.15)', color:'#fff', borderRadius:6, outline:'none' },
  select: { width:'100%', padding:'8px 10px', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.15)', color:'#fff', borderRadius:6, outline:'none' },
  label: { display:'block', opacity:.8, fontSize:12, marginBottom:4 },
  smallBtn: { padding:'6px 10px', borderRadius:6, background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.18)', color:'#fff' },
}

function Btn({ children, onClick, disabled, variant='primary', style, title }) {
  const palette = {
    primary: { bg:'#3aa675', border:'#3aa675', color:'#fff' },
    danger: { bg:'#e15f5f', border:'#e15f5f', color:'#fff' },
    ghost: { bg:'rgba(255,255,255,.08)', border:'rgba(255,255,255,.2)', color:'#fff' },
  }
  const p = palette[variant] || palette.primary
  return (
    <button title={title} disabled={disabled} onClick={onClick} style={{
      padding:'8px 14px', borderRadius:8, border:`1px solid ${p.border}`,
      background: disabled? 'rgba(255,255,255,.12)' : p.bg, color: p.color,
      opacity: disabled? .6 : 1, cursor: disabled? 'not-allowed' : 'pointer',
      ...style,
    }}>{children}</button>
  )
}

function Badge({ text, color = '#3aa675' }) {
  return (
    <span style={{
      display:'inline-block', padding:'2px 8px', borderRadius:999,
      background: color + '22', color, border: `1px solid ${color}66`, fontSize:12, marginRight:8
    }}>{text}</span>
  )
}

function Metric({ title, value, sub, color }) {
  return (
    <div style={{border:'1px solid rgba(255,255,255,.1)', borderRadius:8, padding:12}}>
      <div style={{opacity:.7, fontSize:12}}>{title}</div>
      <div style={{fontSize:22, fontWeight:600, color: color || '#fff'}}>{value}</div>
      {sub ? <div style={{opacity:.7, marginTop:4, fontSize:12}}>{sub}</div> : null}
    </div>
  )
}

function ProgressBar({ value = 0, total = 0 }) {
  const pct = total > 0 ? Math.min(100, Math.round((value/total)*100)) : 0
  return (
    <div style={{height:8, background:'rgba(255,255,255,.08)', borderRadius:999, overflow:'hidden'}}>
      <div style={{width:`${pct}%`, height:'100%', background:'#3aa675'}} />
    </div>
  )
}

function pickNumber(n, fallback = 0) {
  return typeof n === 'number' && isFinite(n) ? n : fallback
}

function computeActualTotals(summary, progress) {
  const planned = pickNumber(summary?.total_requests, pickNumber(summary?.total, 0))
  const doneFromSummary = typeof summary?.done === 'number' ? summary.done : null // 兼容 done:true
  const done = pickNumber(doneFromSummary, pickNumber(progress?.done, 0))
  // 若已完成数有效且小于计划数，优先采用实际完成数
  const actual = done > 0 && (planned === 0 || done <= planned) ? done : (planned || done)
  const elapsed = pickNumber(summary?.duration_ms, pickNumber(summary?.duration, pickNumber(progress?.elapsed_ms, 0)))
  return { planned, actual, elapsed }
}

function friendlySummary(summary, progress) {
  if (!summary) return ''
  const { planned, actual, elapsed } = computeActualTotals(summary, progress)

  const total = actual // 友好展示采用实际完成数
  const ok = pickNumber(summary.req_ok)
  const to = pickNumber(summary.req_timeout)
  const errs = pickNumber(summary.errors)
  const cOK = pickNumber(summary.connect_ok)
  const cFail = pickNumber(summary.connect_fail)
  const rps = elapsed > 0 ? (total * 1000 / elapsed) : 0
  const p2 = (n) => isFinite(n) ? (Math.round(n*100)/100) : 0

  const resp = summary.resp_latency_ms || {}
  const hello = summary.hello_latency_ms || {}

  const okRate = total > 0 ? (ok/total*100) : 0
  const cRate = (cOK + cFail) > 0 ? (cOK/(cOK+cFail)*100) : 0

  let level = '优秀'
  if (to > 0 || errs > 0) level = '一般'
  if (okRate < 95 || cRate < 95) level = '需关注'

  const stopped = actual < planned && planned > 0

  return `${stopped? '（已停止）' : ''}共发起 ${total} 次请求，成功 ${ok} 次（成功率 ${p2(okRate)}%）${to>0?`，超时 ${to} 次`:''}${errs>0?`，错误 ${errs} 次`:''}。` +
         `${cFail===0?`建立了 ${cOK} 个连接（全部成功）`:`连接成功 ${cOK}、失败 ${cFail}`}；` +
         `平均响应 ${p2(resp.avg||0)} ms，P90 ${resp.p90??'-'} ms，P99 ${resp.p99??'-'} ms；` +
         `握手平均 ${p2(hello.avg||0)} ms。` +
         `整体稳定性：${level}；吞吐约 ${p2(rps)} req/s。`
}

export default function LoadTest({ onBack, defaults }) {
  const [form, setForm] = useState(() => ({
    protocol: defaults?.protocol || 'ws',
    ws: defaults?.ws || '',
    broker: defaults?.broker || '',
    username: defaults?.username || '',
    password: defaults?.password || '',
    pub: defaults?.pub || 'device-server',
    sub: defaults?.sub || 'null',
    keepalive: defaults?.keepalive || 240,
    token: defaults?.token || '',
    token_method: defaults?.token_method || 'header',
    client_id: defaults?.client_id || '',
    device_id: defaults?.device_id || '',
    concurrency: 10,
    per_conn: 10,
    message: 'hello',
    hello_timeout_ms: 10000,
    resp_timeout_ms: 10000,
  }))
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [summary, setSummary] = useState(null)
  const [showRaw, setShowRaw] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const offRef = useRef({})

  useEffect(() => {
    const off1 = EventsOn('loadtest_progress', (m) => {
      setProgress(typeof m === 'string' ? JSON.parse(m) : m)
    })
    const off2 = EventsOn('loadtest_done', (m) => {
      const obj = typeof m === 'string' ? JSON.parse(m) : m
      setSummary(obj)
      setRunning(false)
    })
    offRef.current = { off1, off2 }
    return () => { off1 && off1(); off2 && off2() }
  }, [])

  const start = () => {
    setSummary(null)
    setProgress(null)
    setShowRaw(false)
    setRunning(true)
    EventsEmit('loadtest_start', form)
  }
  const stop = () => { EventsEmit('loadtest_stop'); setRunning(false) }

  const calc = useMemo(() => {
    const s = summary
    if (!s) return null
    const { planned, actual, elapsed } = computeActualTotals(s, progress)
    const total = actual
    const ok = pickNumber(s.req_ok)
    const okRate = total>0 ? (ok/total*100) : 0
    const rps = elapsed>0 ? (total * 1000 / elapsed) : 0
    const colorByRate = (r) => r>=99? '#3aa675' : r>=95? '#caa93a' : '#e15f5f'
    const colorByLatency = (v) => v<=50? '#3aa675' : v<=200? '#caa93a' : '#e15f5f'
    const stopped = actual < planned && planned > 0

    return {
      durationMs: elapsed,
      total,
      ok,
      okRate: Math.round(okRate*100)/100,
      rps: Math.round(rps*100)/100,
      okColor: colorByRate(okRate),
      hello: s.hello_latency_ms || {},
      resp: s.resp_latency_ms || {},
      respColor: colorByLatency((s.resp_latency_ms?.p90) ?? 0),
      connectOK: s.connect_ok ?? 0,
      connectFail: s.connect_fail ?? 0,
      timeColor: colorByLatency((s.hello_latency_ms?.avg) ?? 0),
      text: friendlySummary(s, progress),
      stopped,
    }
  }, [summary, progress])

  const progPct = useMemo(() => {
    const v = progress?.done ?? 0
    const t = progress?.total ?? 0
    return t>0 ? Math.min(100, Math.round(v/t*100)) : 0
  }, [progress])

  return (
    <div className="loadtest-page">
      <div className="db-toolbar">
        <Btn variant="ghost" onClick={onBack}>返回</Btn>
        <h3 style={{margin:0}}>并发测试</h3>
        <div style={{flex:1}} />
        {!running ? (
          <Btn variant="primary" onClick={start} title="开始压测">▶ 开始</Btn>
        ) : (
          <Btn variant="danger" onClick={stop} title="停止压测">■ 停止</Btn>
        )}
      </div>

      <div className="db-body" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
        <div>
          <h4>参数</h4>
          <div style={{display:'grid', gap:8}}>
            <div>
              <label style={styles.label}>协议</label>
              <select disabled={running} style={styles.select} value={form.protocol} onChange={e=>setForm(s=>({...s, protocol: e.target.value}))}>
                <option value="ws">WebSocket</option>
                <option value="mqtt">MQTT</option>
              </select>
            </div>

            {form.protocol === 'ws' ? (
              <div>
                <label style={styles.label}>WebSocket URL</label>
                <input disabled={running} style={styles.input} value={form.ws} onChange={e=>setForm(s=>({...s, ws: e.target.value}))} placeholder="ws://127.0.0.1:8000"/>
              </div>
            ) : (
              <>
                <div>
                  <label style={styles.label}>Broker</label>
                  <input disabled={running} style={styles.input} value={form.broker} onChange={e=>setForm(s=>({...s, broker: e.target.value}))} placeholder="ssl://host:8883"/>
                </div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                  <div>
                    <label style={styles.label}>用户名</label>
                    <input disabled={running} style={styles.input} value={form.username} onChange={e=>setForm(s=>({...s, username: e.target.value}))} />
                  </div>
                  <div>
                    <label style={styles.label}>密码</label>
                    <input disabled={running} type="password" style={styles.input} value={form.password} onChange={e=>setForm(s=>({...s, password: e.target.value}))} />
                  </div>
                </div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                  <div>
                    <label style={styles.label}>发布主题</label>
                    <input disabled={running} style={styles.input} value={form.pub} onChange={e=>setForm(s=>({...s, pub: e.target.value}))} />
                  </div>
                  <div>
                    <label style={styles.label}>订阅主题</label>
                    <input disabled={running} style={styles.input} value={form.sub} onChange={e=>setForm(s=>({...s, sub: e.target.value}))} />
                  </div>
                </div>
                <div>
                  <label style={styles.label}>KeepAlive</label>
                  <input disabled={running} type="number" style={styles.input} value={form.keepalive} onChange={e=>setForm(s=>({...s, keepalive: Number(e.target.value)}))} />
                </div>
              </>
            )}

            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
              <div>
                <label style={styles.label}>Token</label>
                <div style={{display:'flex', gap:8}}>
                  <input disabled={running} type={showToken? 'text':'password'} style={{...styles.input, flex:1}} value={form.token} onChange={e=>setForm(s=>({...s, token: e.target.value}))} />
                  <Btn variant="ghost" onClick={()=>setShowToken(v=>!v)} title={showToken? '隐藏':'显示'}>{showToken? '🙈 隐藏':'👁️ 显示'}</Btn>
                </div>
              </div>
              <div>
                <label style={styles.label}>Token方式</label>
                <select disabled={running} style={styles.select} value={form.token_method} onChange={e=>setForm(s=>({...s, token_method: e.target.value}))}>
                  <option value="header">header</option>
                  <option value="query_access_token">query_access_token</option>
                  <option value="query_token">query_token</option>
                </select>
              </div>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
              <div>
                <label style={styles.label}>ClientID</label>
                <input disabled={running} style={styles.input} value={form.client_id} onChange={e=>setForm(s=>({...s, client_id: e.target.value}))} />
              </div>
              <div>
                <label style={styles.label}>DeviceID</label>
                <input disabled={running} style={styles.input} value={form.device_id} onChange={e=>setForm(s=>({...s, device_id: e.target.value}))} />
              </div>
            </div>

            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
              <div>
                <label style={styles.label}>并发数</label>
                <input disabled={running} type="number" min={1} step={1} style={styles.input} value={form.concurrency} onChange={e=>setForm(s=>({...s, concurrency: Number(e.target.value)}))} />
              </div>
              <div>
                <label style={styles.label}>每连接请求数</label>
                <input disabled={running} type="number" min={1} step={1} style={styles.input} value={form.per_conn} onChange={e=>setForm(s=>({...s, per_conn: Number(e.target.value)}))} />
              </div>
            </div>
            <div style={{display:'flex', gap:8, alignItems:'center'}}>
              <span style={{opacity:.7, fontSize:12}}>预设：</span>
              {[1,10,50,100,200].map(n => (
                <button key={'c'+n} style={styles.smallBtn} disabled={running} onClick={()=>setForm(s=>({...s, concurrency:n}))}>{n}</button>
              ))}
              <span style={{opacity:.7, fontSize:12, marginLeft:8}}>每连接：</span>
              {[1,5,10,20,50].map(n => (
                <button key={'n'+n} style={styles.smallBtn} disabled={running} onClick={()=>setForm(s=>({...s, per_conn:n}))}>{n}</button>
              ))}
            </div>

            <div>
              <label style={styles.label}>消息文本</label>
              <input disabled={running} style={styles.input} value={form.message} onChange={e=>setForm(s=>({...s, message: e.target.value}))} />
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
              <div>
                <label style={styles.label}>Hello超时(ms)</label>
                <input disabled={running} type="number" style={styles.input} value={form.hello_timeout_ms} onChange={e=>setForm(s=>({...s, hello_timeout_ms: Number(e.target.value)}))} />
              </div>
              <div>
                <label style={styles.label}>响应超时(ms)</label>
                <input disabled={running} type="number" style={styles.input} value={form.resp_timeout_ms} onChange={e=>setForm(s=>({...s, resp_timeout_ms: Number(e.target.value)}))} />
              </div>
            </div>
            {running && <div style={{opacity:.7, fontSize:12}}>运行中，参数已锁定以确保测试一致性</div>}
          </div>
        </div>

        <div>
          <h4>进度 / 结果</h4>
          {progress && (
            <div style={{border:'1px solid rgba(255,255,255,.1)', padding:12, borderRadius:6, marginBottom:12}}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}>
                <div>进度 {progPct}%</div>
                <div>{(progress.done||0)}/{(progress.total||0)}</div>
              </div>
              <ProgressBar value={progress.done||0} total={progress.total||0} />
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:10}}>
                <Stat label="连接 成功/失败" value={`${progress.connect_ok || 0} / ${progress.connect_fail || 0}`} />
                <Stat label="请求 OK/超时" value={`${progress.req_ok || 0} / ${progress.req_timeout || 0}`} />
                <Stat label="错误/关闭" value={`${progress.errors || 0} / ${progress.closed || 0}`} />
                <Stat label="耗时(ms)" value={progress.elapsed_ms || 0} />
              </div>
            </div>
          )}

          {calc && (
            <div style={{border:'1px solid rgba(255,255,255,.2)', padding:12, borderRadius:8, display:'grid', gap:12}}>
              <div>
                <Badge text={`协议 ${summary.protocol || '-'}`} />
                <Badge text={`成功率 ${calc.okRate}%`} color={calc.okColor} />
                <Badge text={`吞吐 ${calc.rps} req/s`} />
                <Badge text={`总耗时 ${calc.durationMs} ms`} />
                {calc.stopped && <Badge text={'已停止（按实际完成数统计）'} color="#caa93a" />}
              </div>

              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8}}>
                <Metric title="请求成功/总数" value={`${calc.ok}/${calc.total}`} sub={`成功率 ${calc.okRate}%`} color={calc.okColor} />
                <Metric title="握手平均" value={`${Math.round((calc.hello.avg||0))} ms`} sub={`P50 ${calc.hello.p50??'-'} · P90 ${calc.hello.p90??'-'}`} color={calc.timeColor} />
                <Metric title="响应延迟" value={`${Math.round((calc.resp.avg||0))} ms`} sub={`P90 ${calc.resp.p90??'-'} · P99 ${calc.resp.p99??'-'}`} color={calc.respColor} />
              </div>

              <div style={{lineHeight:1.6}}>
                {calc.text}
              </div>

              <div>
                <Btn variant="ghost" onClick={()=>setShowRaw(v=>!v)}>{showRaw? '收起详情' : '查看原始数据'}</Btn>
              </div>
              {showRaw && (
                <pre style={{whiteSpace:'pre-wrap', margin:0}}>{JSON.stringify(summary, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
