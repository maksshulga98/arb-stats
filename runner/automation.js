// Автоматизация браузера: открыть «некрасивую» форму оформления, вставить
// данные клиента, отправить и вытащить «красивую» ссылку (href кнопки
// «Заполнить заявку на сайте банка») со страницы-результата.
//
// Селекторы не зашиты жёстко: поля ищутся по подписи/placeholder/name/aria,
// кнопки — по тексту. Это устойчивее к вёрстке партнёрки и не требует точных
// CSS-селекторов. Тексты подписей/кнопок вынесены в FORM_MAP — при желании
// финализируются под реальный DOM (см. runner/README.md).

import puppeteer from 'puppeteer-core'

// Соответствие «поле задачи → варианты подписи/placeholder/name на странице».
// Порядок вариантов = приоритет поиска.
const FORM_MAP = {
  organization_name: ['Наименование организации', 'организаци', 'название'],
  inn:               ['ИНН', 'inn'],
  legal_address:     ['Юридический адрес', 'адрес'],
  city:              ['Город обслуживания', 'город'],
  contact_person:    ['Контактное лицо', 'фио', 'имя'],
  email:             ['Электронная почта', 'email', 'почта', 'e-mail'],
  phone:             ['Телефон', 'phone', 'тел'],
}

const SUBMIT_TEXTS = ['Отправить заявку', 'Отправить', 'Далее', 'Продолжить']
const RESULT_LINK_TEXTS = ['Заполнить заявку на сайте банка', 'на сайте банка', 'Перейти на сайт банка']

// Найти input/textarea по списку подписей и записать значение так, чтобы
// сработали React-обработчики (нативный setter + событие input).
async function fillField(page, candidates, value) {
  const ok = await page.evaluate((cands, val) => {
    const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const fields = Array.from(document.querySelectorAll('input, textarea'))
      .filter(el => !['hidden', 'submit', 'button'].includes(el.type))

    const labelText = (el) => {
      let t = ''
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (lab) t += ' ' + lab.textContent
      }
      const wrap = el.closest('label')
      if (wrap) t += ' ' + wrap.textContent
      // подпись в предыдущем соседе (частый паттерн: <label>..<input>)
      const prev = el.previousElementSibling
      if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
        t += ' ' + prev.textContent
      }
      t += ' ' + (el.placeholder || '') + ' ' + (el.name || '') + ' ' + (el.getAttribute('aria-label') || '')
      return norm(t)
    }

    for (const cand of cands) {
      const c = norm(cand)
      const target = fields.find(el => labelText(el).includes(c))
      if (target) {
        const proto = target.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        target.focus()
        setter.call(target, '')
        target.dispatchEvent(new Event('input', { bubbles: true }))
        setter.call(target, val)
        target.dispatchEvent(new Event('input', { bubbles: true }))
        target.dispatchEvent(new Event('change', { bubbles: true }))
        target.blur()
        target.dispatchEvent(new Event('blur', { bubbles: true }))
        return true
      }
    }
    return false
  }, candidates, String(value))
  return ok
}

// Телефон с маской: значение лучше «напечатать» с клавиатуры, иначе маска
// его перетрёт. Фокусируем поле и вводим только цифры (без ведущей 7/8).
async function fillPhone(page, candidates, phone) {
  const digits = String(phone).replace(/\D/g, '').replace(/^[78]/, '')
  const focused = await page.evaluate((cands) => {
    const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const fields = Array.from(document.querySelectorAll('input')).filter(el => el.type !== 'hidden')
    const labelText = (el) =>
      norm(`${el.placeholder || ''} ${el.name || ''} ${el.getAttribute('aria-label') || ''} ${el.closest('label')?.textContent || ''}`)
    for (const cand of cands) {
      const c = norm(cand)
      const t = fields.find(el => el.type === 'tel' || labelText(el).includes(c))
      if (t) { t.focus(); return true }
    }
    return false
  }, candidates)
  if (!focused) return false
  await page.keyboard.type(digits, { delay: 40 })
  return true
}

async function clickByText(page, texts) {
  const clicked = await page.evaluate((txts) => {
    const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const els = Array.from(document.querySelectorAll('button, a, input[type=submit], [role=button]'))
    for (const t of txts) {
      const c = norm(t)
      const el = els.find(e => norm(e.textContent || e.value).includes(c))
      if (el) { el.click(); return true }
    }
    return false
  }, texts)
  return clicked
}

async function getLinkHref(page, texts) {
  return page.evaluate((txts) => {
    const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const links = Array.from(document.querySelectorAll('a[href]'))
    for (const t of txts) {
      const c = norm(t)
      const el = links.find(a => norm(a.textContent).includes(c))
      if (el) return el.href
    }
    // запасной вариант: любая ссылка, ведущая на внешний банковский домен
    const ext = links.map(a => a.href).find(h => /alfabank|sberbank|tinkoff|tbank|vtb|bank/i.test(h))
    return ext || null
  }, texts)
}

/**
 * Прогнать одну заявку в уже запущенном профиле Dolphin.
 * @param {string} browserWSEndpoint  из dolphin.startProfile
 * @param {object} job                строка bank_link_jobs
 * @returns {Promise<string>}         «красивая» ссылка
 */
export async function runApplication(browserWSEndpoint, job) {
  const browser = await puppeteer.connect({ browserWSEndpoint, defaultViewport: null })
  try {
    const pages = await browser.pages()
    const page = pages[0] || await browser.newPage()
    page.setDefaultTimeout(45000)

    await page.goto(job.source_url, { waitUntil: 'networkidle2' })

    // Заполняем все текстовые поля
    const results = {}
    for (const [field, candidates] of Object.entries(FORM_MAP)) {
      if (field === 'phone') { results[field] = await fillPhone(page, candidates, job.phone); continue }
      results[field] = await fillField(page, candidates, job[field])
    }
    const missing = Object.entries(results).filter(([, ok]) => !ok).map(([f]) => f)
    if (missing.length) {
      throw new Error('Не нашёл поля формы: ' + missing.join(', ') + ' (нужно уточнить селекторы под реальный DOM)')
    }

    // Отправляем
    const submitted = await clickByText(page, SUBMIT_TEXTS)
    if (!submitted) throw new Error('Не нашёл кнопку отправки формы')

    // Ждём страницу-результат: либо навигация, либо появление кнопки результата
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.waitForFunction(
        (txts) => {
          const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
          return Array.from(document.querySelectorAll('a[href]'))
            .some(a => txts.some(t => norm(a.textContent).includes(norm(t))))
        },
        { timeout: 45000 },
        RESULT_LINK_TEXTS,
      ),
    ])

    const link = await getLinkHref(page, RESULT_LINK_TEXTS)
    if (!link) throw new Error('Страница-результат открылась, но ссылку кнопки не удалось вытащить')
    return link
  } finally {
    // Отключаемся, НЕ закрывая браузер Dolphin (его гасит stopProfile)
    browser.disconnect()
  }
}
