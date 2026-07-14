// Автоматизация браузера: открыть форму оформления, заполнить данными клиента,
// отправить и вытащить «красивую» ссылку (href/redirect кнопки «Заполнить
// заявку на сайте банка») со страницы-результата.
//
// Форма банков-маркета (оффер Альфа-РКО и аналоги) построена на shadcn/ui +
// DaData-автокомплитах. Особенности, установленные по живой форме:
//   • у инпутов НЕТ id/name → адресуемся по порядку полей + сверяем подписи;
//   • «Наименование организации», «Юр.адрес», «Город» — combobox с подсказками
//     role="option" в контейнере role="listbox";
//   • выбор организации ПО ИНН автозаполняет название, ИНН и город;
//   • «Юридический адрес» — отдельный автокомплит с выбором дома;
//   • «Телефон» — маска +7 (___) ___-__-__.
//
// Профиль формы вынесен в FORM_PROFILE — под другой банк добавляется новый.

import puppeteer from 'puppeteer-core'

const FORM_PROFILE = {
  // ожидаемый порядок и подписи полей (для fail-loud проверки, что форма не менялась)
  labels: [
    'Наименование организации', // 0 combobox — вводим ИНН, выбираем из подсказок
    'ИНН',                       // 1 автозаполнится
    'Юридический адрес',         // 2 combobox — вводим адрес, выбираем дом
    'Город обслуживания',        // 3 автозаполнится из организации
    'Контактное лицо',           // 4 текст
    'Электронная почта',         // 5 текст
    'Телефон',                   // 6 маска
  ],
  idx: { org: 0, inn: 1, address: 2, city: 3, contact: 4, email: 5, phone: 6 },
  submitTexts: ['Отправить заявку', 'Отправить'],
  resultLinkTexts: ['Заполнить заявку на сайте банка', 'на сайте банка', 'Перейти на сайт банка', 'на сайт банка'],
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const norm = (s) => (s || '').toLowerCase().replace(/[^0-9a-zа-яё]+/gi, ' ').trim()

async function getInputs(page) {
  const inputs = await page.$$('form input, form textarea')
  if (inputs.length < FORM_PROFILE.labels.length) {
    throw new Error(`Ожидал ≥${FORM_PROFILE.labels.length} полей формы, нашёл ${inputs.length} — форма изменилась, нужно обновить профиль`)
  }
  return inputs
}

// Проверяем, что подписи полей совпадают с ожидаемыми (порядок не «поехал»).
async function verifyForm(page) {
  const labels = await page.evaluate(() => {
    const form = document.querySelector('form')
    const fields = Array.from(form.querySelectorAll('input, textarea'))
    return fields.map(el => {
      let label = '', p = el.parentElement
      while (p && p !== form && !label) {
        const prev = p.previousElementSibling
        if (prev && prev.textContent.trim()) label = prev.textContent.trim()
        p = p.parentElement
      }
      return label
    })
  })
  FORM_PROFILE.labels.forEach((expected, i) => {
    if (!norm(labels[i] || '').includes(norm(expected))) {
      throw new Error(`Поле #${i}: ожидал "${expected}", на форме "${labels[i]}" — профиль формы устарел`)
    }
  })
}

// Впечатать текст в поле (клавиатурой — чтобы сработали обработчики react-hook-form)
async function typeInto(handle, text) {
  await handle.click({ clickCount: 3 })          // выделить существующее
  await handle.press('Backspace').catch(() => {})
  await handle.type(String(text), { delay: 35 })
}

// Дождаться выпадающих подсказок и выбрать пункт, максимально совпадающий с wanted
async function pickOption(page, wanted) {
  await page.waitForSelector('[role="option"]', { timeout: 15000 })
  await sleep(350)                                // дать списку дорисоваться
  const options = await page.$$('[role="option"]')
  const wTokens = norm(wanted).split(' ').filter(Boolean)
  let best = options[0], bestScore = -1
  for (const opt of options) {
    const text = norm(await (await opt.getProperty('textContent')).jsonValue())
    const score = wTokens.filter(tok => text.includes(tok)).length
    if (score > bestScore) { bestScore = score; best = opt }
  }
  await best.click()
  await sleep(300)
}

async function clickSubmit(page) {
  const ok = await page.evaluate((texts) => {
    const nrm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    let btn = document.querySelector('form button[type=submit]')
    if (!btn) {
      const all = Array.from(document.querySelectorAll('button'))
      btn = all.find(b => texts.some(t => nrm(b.textContent).includes(nrm(t))))
    }
    if (btn) { btn.click(); return true }
    return false
  }, FORM_PROFILE.submitTexts)
  if (!ok) throw new Error('Не нашёл кнопку «Отправить заявку»')
}

// Дождаться страницы-результата и достать «красивую» ссылку
async function getResultLink(page, browser) {
  // Ждём появления кнопки/ссылки результата (Step 2)
  await page.waitForFunction((texts) => {
    const nrm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    return Array.from(document.querySelectorAll('a[href], button'))
      .some(e => texts.some(t => nrm(e.textContent).includes(nrm(t))))
  }, { timeout: 60000 }, FORM_PROFILE.resultLinkTexts)
  await sleep(500)

  // 1) Прямой href у <a> с нужным текстом
  const direct = await page.evaluate((texts) => {
    const nrm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const links = Array.from(document.querySelectorAll('a[href]'))
    for (const t of texts) {
      const el = links.find(a => nrm(a.textContent).includes(nrm(t)))
      if (el) return el.href
    }
    return null
  }, FORM_PROFILE.resultLinkTexts)
  if (direct) return direct

  // 2) Кнопка открывает ссылку по клику (новая вкладка / редирект) — кликаем и ловим URL
  const newPagePromise = new Promise((resolve) => {
    const onTarget = async (target) => {
      if (target.type() === 'page') {
        browser.off('targetcreated', onTarget)
        try { resolve((await target.page())?.url() || target.url()) } catch { resolve(target.url()) }
      }
    }
    browser.on('targetcreated', onTarget)
    setTimeout(() => { browser.off('targetcreated', onTarget); resolve(null) }, 15000)
  })
  const navPromise = page.waitForNavigation({ timeout: 15000 }).then(() => page.url()).catch(() => null)

  const clicked = await page.evaluate((texts) => {
    const nrm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const els = Array.from(document.querySelectorAll('a, button, [role=button]'))
    for (const t of texts) {
      const el = els.find(e => nrm(e.textContent).includes(nrm(t)))
      if (el) { el.click(); return true }
    }
    return false
  }, FORM_PROFILE.resultLinkTexts)

  if (clicked) {
    const url = await Promise.race([newPagePromise, navPromise])
    if (url && !/banks-market\.com/.test(url)) return url
    if (url) return url
  }

  // 3) Запасной вариант: любая внешняя банковская ссылка на странице
  const ext = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
    return links.find(h => /alfabank|alfa|sberbank|sber|tinkoff|tbank|vtb|ozon|tochka|otkritie|bank/i.test(h)
      && !/banks-market\.com\/(terms|privacy)/.test(h)) || null
  })
  if (ext) return ext

  throw new Error('Страница-результат открылась, но ссылку кнопки вытащить не удалось (уточнить селектор на первом реальном прогоне)')
}

/**
 * Прогнать одну заявку в запущенном профиле Dolphin.
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
    await page.waitForSelector('form input', { timeout: 30000 })
    await verifyForm(page)

    const I = FORM_PROFILE.idx

    // 1. Организация — вводим ИНН, выбираем единственную подсказку по ИНН.
    //    Это автозаполняет название, ИНН и город.
    let inputs = await getInputs(page)
    await typeInto(inputs[I.org], job.inn)
    await pickOption(page, job.inn)

    // 2. Юридический адрес — вводим адрес клиента, выбираем совпадающий дом.
    inputs = await getInputs(page)
    await typeInto(inputs[I.address], job.legal_address)
    await pickOption(page, job.legal_address)

    // 3. Город — обычно уже автозаполнен. Если пуст — вписываем.
    inputs = await getInputs(page)
    const cityVal = await (await inputs[I.city].getProperty('value')).jsonValue()
    if (!cityVal) {
      await typeInto(inputs[I.city], job.city)
      await pickOption(page, job.city).catch(() => {})
      inputs = await getInputs(page)
    }

    // 4-5. Контактное лицо и email
    await typeInto(inputs[I.contact], job.contact_person)
    await typeInto(inputs[I.email], job.email)

    // 6. Телефон (маска): фокус + печать 10 цифр (без ведущей 7/8)
    const digits = String(job.phone).replace(/\D/g, '').replace(/^[78]/, '')
    await inputs[I.phone].click()
    await page.keyboard.type(digits, { delay: 45 })

    // 7. Отправка
    await clickSubmit(page)

    // 8. Ссылка со страницы-результата
    const link = await getResultLink(page, browser)
    return link
  } finally {
    browser.disconnect()  // не закрываем браузер Dolphin — его гасит stopProfile
  }
}
