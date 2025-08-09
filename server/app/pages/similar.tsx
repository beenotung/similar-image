import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle } from '../../config.js'
import Style from '../components/style.js'
import {
  Context,
  DynamicContext,
  getContextFormBody,
  throwIfInAPI,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { object, string } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { Locale, Title } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
import { env } from '../../env.js'
import { Script } from '../components/script.js'
import { toSlug } from '../format/slug.js'
import { BackToLink } from '../components/back-to-link.js'
import { readdirSync, statSync } from 'fs'
import { Router } from 'express'
import { join } from 'path'
import { format_byte } from '@beenotung/tslib/format.js'

let pageTitle = (
  <Locale en="Find Similar Images" zh_hk="尋找相似圖片" zh_cn="寻找相似图片" />
)
let addPageTitle = <Locale en="TODO" zh_hk="TODO" zh_cn="TODO" />

let style = Style(/* css */ `
#Similar {

}
.image-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}
.image-item {
  --size: 30rem;
  max-width: var(--size);
  max-height: var(--size);
}
.similarity-info {
  text-align: end;
}
`)

let page = (
  <>
    {style}
    <div id="Similar">
      <h1>{pageTitle}</h1>
      <Main />
    </div>
  </>
)

type Image = {
  file: string
  filename: string
  size: number
}

function scanImages(dir: string): Image[] {
  let filenames = readdirSync(dir)
  return filenames
    .filter(
      filename =>
        filename.endsWith('.jpg') ||
        filename.endsWith('.png') ||
        filename.endsWith('.jpeg'),
    )
    .map(filename => {
      let file = join(dir, filename)
      let stat = statSync(file)
      return {
        file,
        filename,
        size: stat.size,
      }
    })
}

function findSimilar(images: Image[]) {
  let n = images.length
  let result = {
    a: images[0],
    b: images[0],
    similarity: -1,
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let a = images[i]
      let b = images[j]
      let newSimilar = calculateSimilarity(a, b)
      if (newSimilar > result.similarity) {
        result = { a, b, similarity: newSimilar }
      }
    }
  }
  return result
}

function calculateSimilarity(a: Image, b: Image) {
  let diff = Math.abs(a.size - b.size)
  let total = a.size + b.size
  let similarity = 1 - diff / total
  return similarity
}

function Main(attrs: {}, context: DynamicContext) {
  let params = new URLSearchParams(context.routerMatch?.search)
  let scan_dir = params.get('scan_dir')

  function renderImage(image: Image) {
    let params = new URLSearchParams({ file: image.file })
    return (
      <div class="image-item">
        <div>
          {image.filename} ({format_byte(image.size)})
        </div>
        <img src={`/image?${params}`} />
      </div>
    )
  }

  function renderImageList() {
    if (!scan_dir) return null
    let images = scanImages(scan_dir)
    let result = findSimilar(images)
    return (
      <>
        <h2>Images</h2>
        <div class="image-list">
          {renderImage(result.a)}
          <div class="similarity-info">
            <div>Similarity: {result.similarity.toFixed(3)}</div>
            <div>Distance: {(1 - result.similarity).toFixed(3)}</div>
          </div>
          {renderImage(result.b)}
        </div>
      </>
    )
  }

  return (
    <>
      <form>
        <label>
          Directory to scan images:
          <br />
          <input type="text" name="scan_dir" value={scan_dir} />
        </label>
        <div>
          <button>Scan</button>
        </div>
      </form>
      {renderImageList()}
      <Link href="/similar/add">
        <button>{addPageTitle}</button>
      </Link>
    </>
  )
}

let addPageStyle = Style(/* css */ `
#AddSimilar .field {
  margin-block-end: 1rem;
}
#AddSimilar .field label input {
  display: block;
  margin-block-start: 0.25rem;
}
#AddSimilar .field label .hint {
  display: block;
  margin-block-start: 0.25rem;
}
`)
let addPageScript = Script(/* js */ `
${toSlug}
function updateSlugPreview() {
  let value = addForm.slug.value || addForm.slug.placeholder
  previewSlug.textContent = toSlug(value)
}
updateSlugPreview()
`)
let addPage = (
  <>
    {addPageStyle}
    <div id="AddSimilar">
      <h1>{addPageTitle}</h1>
      <form
        id="addForm"
        method="POST"
        action="/similar/add/submit"
        onsubmit="emitForm(event)"
      >
        <div class="field">
          <label>
            <Locale en="Title" zh_hk="標題" zh_cn="標題" />
            *:
            <input name="title" required minlength="3" maxlength="50" />
            <p class="hint">
              <Locale
                en="(3 to 50 characters)"
                zh_hk="(3 至 50 個字元)"
                zh_cn="(3 至 50 个字元)"
              />
            </p>
          </label>
        </div>
        <div class="field">
          <label>
            <Locale en="Short URL Code" zh_hk="短網址碼" zh_cn="短网址码" />
            *:
            <input
              name="slug"
              required
              placeholder="e.g. alice-in-wonderland"
              pattern="(\w|-|\.){1,32}"
              oninput="updateSlugPreview()"
            />
            <p class="hint">
              (
              <Locale
                en="1 to 32 characters of: "
                zh_hk="1 至 32 個字元："
                zh_cn="1 至 32 个字元："
              />
              <code>a-z A-Z 0-9 - _ .</code>)
              <br />
              <Locale
                en="A unique part of the URL, e.g. "
                zh_hk="網址的一部分，例如："
                zh_cn="网址的一部分，例如："
              />
              <code>
                {env.ORIGIN}/<i id="previewSlug">alice-in-wonderland</i>
              </code>
            </p>
          </label>
        </div>
        <input
          type="submit"
          value={<Locale en="Submit" zh_hk="提交" zh_cn="提交" />}
        />
        <p>
          <Locale en="Remark:" zh_hk="備註：" zh_cn="备注：" />
          <br />
          <Locale
            en="* mandatory fields"
            zh_hk="* 必填欄位"
            zh_cn="* 必填字段"
          />
        </p>
        <p id="add-message"></p>
      </form>
    </div>
    {addPageScript}
  </>
)

let submitParser = object({
  title: string({ minLength: 3, maxLength: 50 }),
  slug: string({ match: /^[\w-]{1,32}$/ }),
})

function Submit(attrs: {}, context: DynamicContext) {
  try {
    let body = getContextFormBody(context)
    let input = submitParser.parse(body)
    // let id = items.push({
    //   title: input.title,
    //   slug: input.slug,
    // })
    let id = 'TODO'
    return <Redirect href={`/similar/result?id=${id}`} />
  } catch (error) {
    throwIfInAPI(error, '#add-message', context)
    return (
      <Redirect
        href={
          '/similar/result?' + new URLSearchParams({ error: String(error) })
        }
      />
    )
  }
}

function SubmitResult(attrs: {}, context: DynamicContext) {
  let params = new URLSearchParams(context.routerMatch?.search)
  let error = params.get('error')
  let id = params.get('id')
  return (
    <div>
      {error ? (
        renderError(error, context)
      ) : (
        <>
          <p>
            <Locale
              en={`Your submission is received (#${id}).`}
              zh_hk={`你的提交已收到 (#${id})。`}
              zh_cn={`你的提交已收到 (#${id})。`}
            />
          </p>
          <BackToLink href="/similar" title={pageTitle} />
        </>
      )}
    </div>
  )
}

function attachRoutes(app: Router) {
  app.get('/image', (req, res) => {
    let file = req.query.file
    if (typeof file !== 'string') {
      res.status(400).send('missing file in req.query')
      return
    }
    res.sendFile(file)
  })
}

let routes = {
  '/similar': {
    menuText: pageTitle,
    title: <Title t={pageTitle} />,
    description: 'TODO',
    node: page,
  },
  '/similar/add': {
    title: <Title t={addPageTitle} />,
    description: 'TODO',
    node: addPage,
    streaming: false,
  },
  '/similar/add/submit': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <Submit />,
    streaming: false,
  },
  '/similar/result': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <SubmitResult />,
    streaming: false,
  },
} satisfies Routes

export default { routes, attachRoutes }
