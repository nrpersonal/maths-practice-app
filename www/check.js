/* Independent answer checker.
   Re-solves each question from its text, using exact fractions (BigInt), without using any of
   the code that generated the question. verifyQ(q) returns:
     {status:'ok', correct:i}           the marked answer is right
     {status:'fixed', correct:i, was:j} a different option is the right one
     {status:'none', answer:'...'}      no option is right (answer given when it can be computed)
     {status:'ambiguous'}               more than one option is right
     {status:'unknown'}                 question type not recognised                         */
(function (G) {
  'use strict';

  /* ---------- exact rationals ---------- */
  const babs = x => (x < 0n ? -x : x);
  const bgcd = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
  function rat(n, d = 1n) {
    n = BigInt(n); d = BigInt(d);
    if (d === 0n) throw new Error('div0');
    if (d < 0n) { n = -n; d = -d; }
    const g = bgcd(n, d) || 1n;
    return { n: n / g, d: d / g };
  }
  const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
  const div = (a, b) => rat(a.n * b.d, a.d * b.n);
  const neg = a => rat(-a.n, a.d);
  const eq = (a, b) => a && b && a.n === b.n && a.d === b.d;
  const isInt = a => a.d === 1n;
  function pow(a, e) {
    if (!isInt(e)) throw new Error('frac exponent');
    let k = e.n, r = rat(1n);
    if (babs(k) > 400n) throw new Error('exponent too big');
    const base = k < 0n ? div(rat(1n), a) : a;
    for (k = babs(k); k > 0n; k--) r = mul(r, base);
    return r;
  }
  function dec(s) { // "12.034" -> rational, exact
    const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
    if (!m || (m[1] === '' && !m[2])) throw new Error('bad number ' + s);
    const f = m[2] || '';
    return rat(BigInt((m[1] || '0') + f), 10n ** BigInt(f.length));
  }
  const R = x => (typeof x === 'object' ? x : Number.isInteger(x) ? rat(BigInt(x)) : dec(String(x)));
  const cmp = (a, b) => { const s = sub(a, b).n; return s < 0n ? -1 : s > 0n ? 1 : 0; };
  const floorR = a => { let q = a.n / a.d; if (a.n < 0n && q * a.d !== a.n) q -= 1n; return rat(q); };
  const toNum = a => Number(a.n) / Number(a.d);

  /* ---------- text normalisation ---------- */
  function norm(html) {
    return String(html)
      .replace(/<span class="fr"><span>([^<]*)<\/span><span>([^<]*)<\/span><\/span>/g, '($1/$2)')
      .replace(/<sup>([^<]*)<\/sup>/g, '^($1)')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/[−–]/g, '-').replace(/×/g, '*').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3').replace(/…/g, '...')
      .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
      .replace(/\s+/g, ' ').trim();
  }

  /* ---------- expression parser (implicit multiplication binds tighter than * and /) ---------- */
  function tokenize(s) {
    const out = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') { i++; continue; }
      if (/[\d.]/.test(c)) { let j = i; while (j < s.length && /[\d.]/.test(s[j])) j++; out.push({ t: 'n', v: dec(s.slice(i, j)) }); i = j; continue; }
      if (/[a-z]/.test(c)) { out.push({ t: 'v', v: c }); i++; continue; }
      if (c === '?') { out.push({ t: 'v', v: '?' }); i++; continue; }
      if ('+-*/^()'.includes(c)) { out.push({ t: c }); i++; continue; }
      throw new Error('bad char ' + c);
    }
    return out;
  }
  function parse(s) {
    const tk = tokenize(s); let p = 0;
    const peek = () => tk[p] && tk[p].t, eat = t => { if (peek() !== t) throw new Error('expected ' + t); p++; };
    function expr() { let a = term(); while (peek() === '+' || peek() === '-') { const o = tk[p++].t, b = term(); a = { o, a, b }; } return a; }
    function term() { let a = unary(); while (peek() === '*' || peek() === '/') { const o = tk[p++].t, b = unary(); a = { o, a, b }; } return a; }
    function unary() { if (peek() === '-') { p++; return { o: 'neg', a: unary() }; } if (peek() === '+') { p++; return unary(); } return juxt(); }
    function juxt() { let a = power(); while (peek() === 'v' || peek() === '(' || (peek() === 'n' && a.o !== 'num' && false)) { a = { o: '*', a, b: power() }; } return a; }
    function power() {
      const a = atom();
      if (peek() === '^') { p++; let e; if (peek() === '-') { p++; e = { o: 'neg', a: atom() }; } else e = atom(); return { o: '^', a, b: e }; }
      return a;
    }
    function atom() {
      const t = tk[p];
      if (!t) throw new Error('unexpected end');
      if (t.t === 'n') { p++; return { o: 'num', v: t.v }; }
      if (t.t === 'v') { p++; return { o: 'var', v: t.v }; }
      if (t.t === '(') { p++; const e = expr(); eat(')'); return { o: 'par', a: e }; }
      throw new Error('unexpected ' + t.t);
    }
    const e = expr();
    if (p !== tk.length) throw new Error('trailing tokens');
    return e;
  }
  function ev(e, env) {
    switch (e.o) {
      case 'num': return e.v;
      case 'var': if (!(e.v in env)) throw new Error('unbound ' + e.v); return env[e.v];
      case 'par': return ev(e.a, env);
      case 'neg': return neg(ev(e.a, env));
      case '+': return add(ev(e.a, env), ev(e.b, env));
      case '-': return sub(ev(e.a, env), ev(e.b, env));
      case '*': return mul(ev(e.a, env), ev(e.b, env));
      case '/': return div(ev(e.a, env), ev(e.b, env));
      case '^': return pow(ev(e.a, env), ev(e.b, env));
    }
    throw new Error('bad node');
  }
  const hasBracket = s => /\(/.test(s.replace(/\^\(-?\d+\)/g, ''));
  const varsOf = s => [...new Set((s.match(/[a-z]/g) || []))];
  const evalStr = (s, env = {}) => ev(parse(s), env);
  // Two expressions are equivalent if they agree at several unrelated points.
  const POINTS = [[2, 3, 5, 7, 11], [13, 17, 19, 23, 29], [rat(3n, 7n), rat(-5n, 2n), rat(11n, 3n), rat(-7n, 5n), rat(4n, 9n)]];
  function equiv(a, b) {
    const vs = [...new Set(varsOf(a).concat(varsOf(b)))];
    const ea = parse(a), eb = parse(b);
    return POINTS.every(pt => { const env = {}; vs.forEach((v, i) => env[v] = R(pt[i % pt.length])); return eq(ev(ea, env), ev(eb, env)); });
  }

  /* ---------- small helpers ---------- */
  function num(s) { // signed decimal, or a full expression without letters
    s = String(s).trim();
    if (/^-?\d*\.?\d+$/.test(s)) return s[0] === '-' ? neg(dec(s.slice(1))) : dec(s);
    if (/[a-z?]/.test(s)) throw new Error('not a number');
    return evalStr(s);
  }
  const isPrime = n => { if (n < 2n) return false; for (let i = 2n; i * i <= n; i++) if (n % i === 0n) return false; return true; };
  const ROM = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  const toRoman = n => { let s = ''; for (const [v, r] of ROM) while (n >= v) { s += r; n -= v; } return s; };
  function fromRoman(s) { const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let t = 0; for (let i = 0; i < s.length; i++) { const a = v[s[i]], b = v[s[i + 1]] || 0; t += a < b ? -a : a; } return toRoman(t) === s ? t : NaN; }
  function roundTo(x, step) { // half away from zero, to a multiple of step
    const q = div(x, step), s = x.n < 0n ? -1n : 1n;
    const aq = rat(babs(q.n), q.d);
    return mul(rat(s), mul(floorR(add(aq, rat(1n, 2n))), step));
  }
  function sigStep(x, k) { // 10^(e-k+1), where 10^e <= |x| < 10^(e+1)
    let ax = rat(babs(x.n), x.d), e = 0;
    if (ax.n === 0n) return rat(1n);
    while (cmp(ax, rat(10n)) >= 0) { ax = div(ax, rat(10n)); e++; }
    while (cmp(ax, rat(1n)) < 0) { ax = mul(ax, rat(10n)); e--; }
    return pow(rat(10n), rat(BigInt(e - k + 1)));
  }

  /* ---------- option parsing ---------- */
  const UNITS = ['cm²', 'm²', 'mm²', 'km²', '°C', '°', '%', 'p', 'mm', 'cm', 'm', 'km', 'g', 'kg', 'ml', 'l', 'cm³'];
  function unitOf(q, opts) {
    if (typeof q.unit === 'string') return q.unit;
    for (const u of UNITS) if (opts.length && opts.every(o => o.endsWith(' ' + u))) return u;
    return '';
  }
  // A single fraction that isn't in lowest terms is never treated as a right answer.
  const unreduced = s => { const m = /^-?\((\d+)\/(\d+)\)$/.exec(s.replace(/\s/g, '')); return !!(m && bgcd(BigInt(m[1]), BigInt(m[2])) !== 1n); };
  function optVal(s) { if (unreduced(s)) throw new Error('unreduced'); return num(s); }

  /* ---------- solvers: each returns {test(optText)->bool, answer?} or null ---------- */
  const value = (v, fmt) => ({ test: s => eq(optVal(s), v), answer: fmt || fmtR(v) });
  function fmtR(v) {
    if (isInt(v)) return v.n.toString().replace(/^-/, '−');
    const x = toNum(v);
    if (Number.isFinite(x) && Math.abs(x) < 1e15) {
      const s = String(+x.toPrecision(12)); try { if (eq(num(s), v)) return s.replace(/^-/, '−'); } catch (e) {}
    }
    return (v.n < 0n ? '−' : '') + babs(v.n) + '/' + v.d;
  }
  const LEN = { mm: 1n, cm: 10n, m: 1000n, km: 1000000n }, MASS = { g: 1n, kg: 1000n }, VOL = { ml: 1n, l: 1000n };
  const UF = Object.assign({}, LEN, MASS, VOL), UK = u => (u in LEN ? 'L' : u in MASS ? 'M' : 'V');
  const TIME = { second: 1n, minute: 60n, hour: 3600n, day: 86400n, week: 604800n };
  const NUM = '(-?\\d*\\.?\\d+)';
  const coin = s => { s = s.trim(); let m; if ((m = /^£(\d+(?:\.\d+)?)$/.exec(s))) return mul(dec(m[1]), rat(100n)); if ((m = /^(\d+)p$/.exec(s))) return rat(BigInt(m[1])); throw new Error('coin'); };

  const SOLVERS = [
    // measures: "2 kg 270 g = ? g"
    t => {
      const m = /^((?:\d*\.?\d+ ?(?:km|kg|mm|cm|ml|m|g|l) ?)+)= \? ?(km|kg|mm|cm|ml|m|g|l)$/.exec(t);
      if (!m) return null;
      const parts = [...m[1].matchAll(/(\d*\.?\d+) ?(km|kg|mm|cm|ml|m|g|l)\b/g)];
      if (parts.some(p => UK(p[2]) !== UK(m[2]))) return null;
      let tot = rat(0n); for (const p of parts) tot = add(tot, mul(dec(p[1]), rat(UF[p[2]])));
      return value(div(tot, rat(UF[m[2]])));
    },
    // roman numerals
    t => { const m = /^What is (\d+) in Roman numerals\?$/.exec(t); return m ? { test: s => s.trim() === toRoman(+m[1]), answer: toRoman(+m[1]) } : null; },
    t => { const m = /^What is ([IVXLCDM]+) as a number\?$/.exec(t); if (!m) return null; const v = fromRoman(m[1]); return isNaN(v) ? null : value(rat(BigInt(v))); },
    // time
    t => {
      const m = /^How many (second|minute|hour|day|week)s are in (.+)\?$/.exec(t); if (!m) return null;
      let tot = rat(0n); const parts = [...m[2].matchAll(/(\d+) (second|minute|hour|day|week)s?/g)];
      if (!parts.length) return null; for (const p of parts) tot = add(tot, rat(BigInt(p[1]) * TIME[p[2]]));
      return value(div(tot, rat(TIME[m[1]])));
    },
    t => {
      const m = /^A \w+ starts at (\d{1,2}):(\d{2})\. It lasts (\d+) minutes?\. What time does it end\?$/.exec(t); if (!m) return null;
      const end = (+m[1] * 60 + +m[2] + +m[3]) % 720;
      const f = x => { const h = Math.floor(x / 60) % 12 || 12; return h + ':' + String(x % 60).padStart(2, '0'); };
      return { test: s => { const o = /^(\d{1,2}):(\d{2})$/.exec(s.trim()); if (!o || +o[2] > 59 || +o[1] > 12) return false; return ((+o[1] % 12) * 60 + +o[2]) % 720 === end % 720; }, answer: f(end) };
    },
    // temperature
    t => { const m = new RegExp(`^The temperature is ${NUM}°C\\. It (rises|falls) by ${NUM}°C\\. What is the new temperature\\?$`).exec(t); if (!m) return null; const a = num(m[1]), b = num(m[3]); return value(m[2] === 'rises' ? add(a, b) : sub(a, b)); },
    // angles
    t => { const m = new RegExp(`^Two angles in a triangle are ${NUM}° and ${NUM}°\\. Find the third angle\\.$`).exec(t); return m ? value(sub(rat(180n), add(num(m[1]), num(m[2])))) : null; },
    t => { const m = new RegExp(`^Angles on a straight line: one is ${NUM}°\\. What is the other\\?$`).exec(t); return m ? value(sub(rat(180n), num(m[1]))) : null; },
    t => { const m = /^What is each (exterior|interior) angle of a regular (\d+)-sided polygon\?$/.exec(t); if (!m) return null; const ext = div(rat(360n), rat(BigInt(m[2]))); return value(m[1] === 'exterior' ? ext : sub(rat(180n), ext)); },
    t => { const m = /^What do the interior angles of an? (\d+)-sided polygon add up to\?$/.exec(t); return m ? value(rat((BigInt(m[1]) - 2n) * 180n)) : null; },
    // circles (uses floating point pi, rounded to 1 d.p.)
    t => {
      const m = new RegExp(`^A circle has (radius|diameter) ${NUM} ?\\w*\\. Find its (area|circumference) to 1 d\\.p\\.$`).exec(t); if (!m) return null;
      const r = toNum(num(m[2])) / (m[1] === 'diameter' ? 2 : 1), v = m[3] === 'area' ? Math.PI * r * r : 2 * Math.PI * r;
      const want = dec((Math.round(v * 10) / 10).toFixed(1));
      return value(want);
    },
    // rounding
    t => { const m = new RegExp(`^Round ${NUM} to the nearest (\\d+)\\.$`).exec(t); return m ? value(roundTo(num(m[1]), dec(m[2]))) : null; },
    t => { const m = new RegExp(`^Round ${NUM} to (\\d+) decimal places?\\.$`).exec(t); return m ? value(roundTo(num(m[1]), pow(rat(10n), rat(-BigInt(m[2]))))) : null; },
    t => { const m = new RegExp(`^Round ${NUM} to (\\d+) significant figures?\\.$`).exec(t); if (!m) return null; const x = num(m[1]); return value(roundTo(x, sigStep(x, +m[2]))); },
    // standard form
    t => {
      const m = /^Write (\S+) in standard form\.$/.exec(t); if (!m) return null; const x = num(m[1]);
      return { test: s => { const o = /^(-?\d*\.?\d+) \* 10\^\((-?\d+)\)$/.exec(s.trim()); if (!o) return false; const mm = num(o[1]), am = rat(babs(mm.n), mm.d); return cmp(am, rat(1n)) >= 0 && cmp(am, rat(10n)) < 0 && eq(mul(mm, pow(rat(10n), rat(BigInt(o[2])))), x); } };
    },
    t => { const m = /^Write (-?\d*\.?\d+) \* 10\^\((-?\d+)\) as an ordinary number\.$/.exec(t); return m ? value(mul(num(m[1]), pow(rat(10n), rat(BigInt(m[2]))))) : null; },
    // percentages
    t => { const m = new RegExp(`^What is ${NUM}% of £?${NUM}\\?$`).exec(t); return m ? value(mul(div(num(m[1]), rat(100n)), num(m[2]))) : null; },
    t => { const m = new RegExp(`^(Increase|Decrease) £?${NUM} by ${NUM}%\\.$`).exec(t); if (!m) return null; const f = div(num(m[3]), rat(100n)); return value(mul(num(m[2]), m[1] === 'Increase' ? add(rat(1n), f) : sub(rat(1n), f))); },
    t => {
      const m = new RegExp(`^A price changes from £?${NUM} to £?${NUM}\\. What is the percentage (increase|decrease)\\?$`).exec(t); if (!m) return null;
      const a = num(m[1]), b = num(m[2]), ch = mul(div(sub(b, a), a), rat(100n));
      if ((m[3] === 'increase') !== (ch.n > 0n)) return { test: () => false };
      return value(rat(babs(ch.n), ch.d));
    },
    // fractions of amounts: "What is (3/4) of 16?"
    t => { const m = new RegExp(`^What is (\\(\\d+/\\d+\\)) of £?${NUM}\\?$`).exec(t); return m ? value(mul(evalStr(m[1]), num(m[2]))) : null; },
    // fractions / decimals / percentages
    t => {
      const m = /^Write (.+?) as (a decimal|a percentage|a fraction in its simplest form)\.$/.exec(t); if (!m) return null;
      const x = /%$/.test(m[1]) ? div(num(m[1].slice(0, -1)), rat(100n)) : num(m[1]);
      if (m[2] === 'a percentage') return value(mul(x, rat(100n)));
      if (m[2] === 'a decimal') return { test: s => /^-?\d*\.?\d+$/.test(s.trim()) && eq(num(s), x), answer: fmtR(x) };
      return { test: s => { const z = s.replace(/\s/g, ''); return (/^-?\(\d+\/\d+\)$/.test(z) || /^-?\d+$/.test(z)) && eq(optVal(z), x); } };
    },
    // HCF / LCM / remainder / primes / roots
    t => {
      const m = /^What is the (HCF|LCM) of (\d+) and (\d+)\?$/.exec(t); if (!m) return null;
      const a = BigInt(m[2]), b = BigInt(m[3]), g = bgcd(a, b); return value(rat(m[1] === 'HCF' ? g : a / g * b));
    },
    t => { const m = /^What is the remainder when (\d+) is divided by (\d+)\?$/.exec(t); return m ? value(rat(BigInt(m[1]) % BigInt(m[2]))) : null; },
    t => { const m = /^What is the first prime number after (\d+)\?$/.exec(t); if (!m) return null; let n = BigInt(m[1]) + 1n; while (!isPrime(n)) n++; return value(rat(n)); },
    t => /^Which of these is a prime number\?$/.test(t) ? { test: s => /^\d+$/.test(s.trim()) && isPrime(BigInt(s.trim())) } : null,
    t => {
      const m = /^What is the (square|cube) root of (\d+)\?$/.exec(t); if (!m) return null; const k = m[1] === 'square' ? 2 : 3, n = BigInt(m[2]);
      return { test: s => { const v = optVal(s); return eq(pow(v, rat(BigInt(k))), rat(n)) && v.n >= 0n; } };
    },
    // place value
    t => {
      const m = /^What is the value of the digit (\d) in (\d+)\?$/.exec(t); if (!m) return null;
      const s = m[2], vals = []; for (let i = 0; i < s.length; i++) if (s[i] === m[1]) vals.push(rat(BigInt(m[1]) * 10n ** BigInt(s.length - 1 - i)));
      return { test: o => vals.some(v => eq(optVal(o), v)) };
    },
    t => {
      if (!/^What is (\d+ (thousands|hundreds|tens|ones)[, ]*(and )?)+\?$/.test(t)) return null;
      const P = { thousands: 1000n, hundreds: 100n, tens: 10n, ones: 1n }; let tot = 0n;
      for (const p of t.matchAll(/(\d+) (thousands|hundreds|tens|ones)/g)) tot += BigInt(p[1]) * P[p[2]];
      return value(rat(tot));
    },
    // "What is one more than 13?"
    t => { const m = /^What is (one|ten|a hundred|one hundred|a thousand|one thousand) (more|less) than (-?\d+)\?$/.exec(t); if (!m) return null; const k = { one: 1n, ten: 10n }[m[1]] || (/hundred/.test(m[1]) ? 100n : 1000n); return value(add(num(m[3]), rat(m[2] === 'more' ? k : -k))); },
    // money (answers in pence)
    t => {
      let m = /^(An? .+ coin(?: and an? .+ coin)+)\. How much altogether\?$/i.exec(t), tot;
      if (m) { tot = rat(0n); for (const c of m[1].matchAll(/\ban? (£?\d+p?) coin/gi)) tot = add(tot, coin(c[1])); }
      else if ((m = /^You pay (£?[\d.]+p?) for something that costs (£?[\d.]+p?)\. How much change\?$/.exec(t))) tot = sub(coin(m[1]), coin(m[2]));
      else return null;
      return value(tot);
    },
    // rectangles and triangles
    t => { const m = new RegExp(`^A rectangle is ${NUM} ?\\w* long and ${NUM} ?\\w* wide\\. What is its perimeter\\?$`).exec(t); return m ? value(mul(rat(2n), add(num(m[1]), num(m[2])))) : null; },
    t => { const m = new RegExp(`^A rectangle has perimeter ${NUM} ?\\w* and length ${NUM} ?\\w*\\. How wide is it\\?$`).exec(t); return m ? value(sub(div(num(m[1]), rat(2n)), num(m[2]))) : null; },
    t => { const m = new RegExp(`^What is the area of a rectangle ${NUM} ?\\w* by ${NUM} ?\\w*\\?$`).exec(t); return m ? value(mul(num(m[1]), num(m[2]))) : null; },
    t => { const m = new RegExp(`^A rectangle has area ${NUM} ?\\S* and length ${NUM} ?\\w*\\. What is its width\\?$`).exec(t); return m ? value(div(num(m[1]), num(m[2]))) : null; },
    t => { const m = new RegExp(`^A triangle has base ${NUM} ?\\w* and height ${NUM} ?\\w*\\. What is its area\\?$`).exec(t); return m ? value(div(mul(num(m[1]), num(m[2])), rat(2n))) : null; },
    t => { const m = new RegExp(`^A triangle has area ${NUM} ?\\S* and base ${NUM} ?\\w*\\. What is its height\\?$`).exec(t); return m ? value(div(mul(rat(2n), num(m[1])), num(m[2]))) : null; },
    // ratio
    t => {
      const m = new RegExp(`^Share £?${NUM} between (\\w+) and (\\w+) in the ratio (\\d+) : (\\d+)\\. How much does (\\w+) get\\?$`).exec(t); if (!m) return null;
      const who = m[6] === m[2] ? m[4] : m[6] === m[3] ? m[5] : null; if (!who) return null;
      return value(div(mul(num(m[1]), dec(who)), add(dec(m[4]), dec(m[5]))));
    },
    t => {
      const m = new RegExp(`^£?${NUM} is shared in the ratio ([\\d : ]+)\\. What is the (largest|smallest) share\\?$`).exec(t); if (!m) return null;
      const ps = m[2].split(':').map(x => dec(x.trim())), tot = ps.reduce(add), pick = ps.reduce((a, b) => ((cmp(a, b) > 0) === (m[3] === 'largest') ? a : b));
      return value(div(mul(num(m[1]), pick), tot));
    },
    t => {
      const m = /^Simplify the ratio (\d+) : (\d+)$/.exec(t); if (!m) return null; const a = BigInt(m[1]), b = BigInt(m[2]);
      return { test: s => { const o = /^(\d+) : (\d+)$/.exec(s.trim()); if (!o) return false; const x = BigInt(o[1]), y = BigInt(o[2]); return bgcd(x, y) === 1n && x * b === y * a; } };
    },
    t => {
      const m = /^The ratio of (\w+) to (\w+) is (\d+) : (\d+)\. There are (\d+) (\w+)\. How many (\w+) are there\?$/.exec(t); if (!m) return null;
      const share = { [m[1]]: dec(m[3]), [m[2]]: dec(m[4]) }; if (!(m[6] in share) || !(m[7] in share)) return null;
      return value(div(mul(dec(m[5]), share[m[7]]), share[m[6]]));
    },
    // sequences
    t => {
      const m = /^What comes next\? ((?:-?\d+, )+)\?$/.exec(t); if (!m) return null;
      const xs = m[1].split(',').map(s => s.trim()).filter(Boolean).map(num); if (xs.length < 3) return null;
      const d = sub(xs[1], xs[0]); if (xs.every((x, i) => !i || eq(sub(x, xs[i - 1]), d))) return value(add(xs[xs.length - 1], d));
      if (xs[0].n === 0n) return null; const r = div(xs[1], xs[0]); if (xs.every((x, i) => !i || eq(div(x, xs[i - 1]), r))) return value(mul(xs[xs.length - 1], r));
      return null;
    },
    t => {
      const m = /^Find the nth term: ((?:-?\d+, )+-?\d+),? ?\.\.\.$/.exec(t); if (!m) return null;
      const xs = m[1].split(',').map(s => num(s.trim()));
      return { test: s => { if (/[a-mo-z]/.test(s)) return false; const e = parse(s); return xs.every((x, i) => eq(ev(e, { n: rat(BigInt(i + 1)) }), x)); } };
    },
    t => { const m = /^The nth term is (.+)\. What is the (\d+)(?:st|nd|rd|th) term\?$/.exec(t); return m ? value(evalStr(m[1], { n: rat(BigInt(m[2])) })) : null; },
    // formulae and substitution
    t => {
      const m = /^([a-z]) = (.+)\. Find \1 when (.+)\.$/.exec(t) || /^Find the value of (.+?) when (.+)\.$/.exec(t); if (!m) return null;
      const [ex, as] = m.length === 4 ? [m[2], m[3]] : [m[1], m[2]], env = {};
      for (const a of as.split(/,| and /)) { const k = /^\s*([a-z]) = (.+?)\s*$/.exec(a); if (!k) return null; env[k[1]] = num(k[2]); }
      return value(evalStr(ex, env));
    },
    // algebra
    t => { const m = /^Expand(?: and simplify)?: (.+)$/.exec(t); return m ? { test: s => !hasBracket(s) && equiv(s, m[1]) } : null; },
    t => {
      const m = /^Factorise(?: fully)?: (.+)$/.exec(t); if (!m) return null;
      return { test: s => {
        const z = s.replace(/\s/g, '').replace(/\^\((-?\d+)\)/g, '^$1');
        const o = /^(-?[\da-z^]*)((?:\([^()]+\))+)$/.exec(z); if (!o || !equiv(s, m[1])) return false;
        const groups = o[2].slice(1, -1).split(')(');
        if (groups.length === 1 && (!o[1] || o[1] === '-')) return false; // nothing taken out
        return groups.every(gr => {
          const terms = gr.replace(/-/g, '+-').split('+').filter(Boolean);
          if (terms.length < 2) return false;
          const g = terms.map(x => BigInt(/^-?(\d*)/.exec(x)[1] || '1')).reduce(bgcd);
          const shared = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(v => terms.every(x => x.includes(v)));
          return g === 1n && shared.length === 0;
        });
      } };
    },
    t => { const m = /^Simplify: (.+)$/.exec(t); return m ? { test: s => !hasBracket(s) && equiv(s, m[1]) } : null; },
    // equations: "8 + ? = 10", "Solve: 3x - 3 = x + 1", "a^6 / a^2 = a^?"; Half of / Double
    t => {
      let s = t.replace(/^Solve:\s*/, '').replace(/^Half of (\S+)/, '(1/2)*$1').replace(/^Double (\S+)/, '2*$1');
      const sides = s.split(' = '); if (sides.length !== 2) return null;
      const vs = varsOf(s); const unknown = s.includes('?') ? '?' : vs.length === 1 ? vs[0] : null; if (!unknown) return null;
      const L = parse(sides[0]), Rt = parse(sides[1]), others = vs.filter(v => v !== unknown);
      const ok = v => [2, 3].every(base => { const env = { [unknown]: v }; others.forEach((o, i) => env[o] = rat(BigInt(base + i))); try { return eq(ev(L, env), ev(Rt, env)); } catch (e) { return false; } });
      let answer; // linear unknown: solve directly from two evaluations
      try { const f = v => { const env = { [unknown]: v }; others.forEach((o, i) => env[o] = rat(BigInt(2 + i))); return sub(ev(L, env), ev(Rt, env)); };
        const f0 = f(rat(0n)), f1 = f(rat(1n)), slope = sub(f1, f0); if (slope.n !== 0n) { const x = div(neg(f0), slope); if (ok(x)) answer = fmtR(x); } } catch (e) {}
      return { test: o => ok(optVal(o)), answer };
    },
    // plain "What is 9^2 ?"
    t => { const m = /^What is (.+?) ?\?$/.exec(t); if (!m || /[a-z]/.test(m[1])) return null; try { return value(evalStr(m[1])); } catch (e) { return null; } },
  ];

  function solve(text) {
    for (const s of SOLVERS) { let r = null; try { r = s(text); } catch (e) { r = null; } if (r) return r; }
    return null;
  }

  function verifyQ(q) {
    try {
      const text = norm(q.q), raw = (q.opts || []).map(norm), rawUnit = unitOf(q, (q.opts || []).map(o => String(o).replace(/<[^>]+>/g, '').trim())), unit = norm(rawUnit);
      const opts = raw.map(o => (unit && o.endsWith(' ' + unit) ? o.slice(0, -unit.length - 1) : o).trim());
      const sv = solve(text);
      if (!sv) return { status: 'unknown' };
      const hits = opts.map(o => { try { return !!sv.test(o); } catch (e) { return false; } });
      const idx = hits.map((h, i) => (h ? i : -1)).filter(i => i >= 0);
      if (idx.length === 1) return idx[0] === q.correct ? { status: 'ok', correct: q.correct } : { status: 'fixed', correct: idx[0], was: q.correct };
      if (idx.length > 1) return { status: 'ambiguous', options: idx };
      return { status: 'none', answer: sv.answer ? sv.answer + (rawUnit ? ' ' + rawUnit : '') : null };
    } catch (e) {
      return { status: 'unknown', error: String(e && e.message || e) };
    }
  }

  G.verifyQ = verifyQ;
  G.__check = { norm, solve, evalStr, equiv };
})(typeof window !== 'undefined' ? window : globalThis);
