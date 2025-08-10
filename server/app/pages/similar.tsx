import { o } from '../jsx/jsx.js'
import { count, find, seedRow } from 'better-sqlite3-proxy'
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
import { boolean, id, int, object, string } from 'cast.ts'
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
import { basename, join, resolve } from 'path'
import { format_byte } from '@beenotung/tslib/format.js'
import { loadImageModel, PreTrainedImageModels } from 'tensorflow-helpers'
import * as tf from '@tensorflow/tfjs-node'
import { toRouteUrl } from '../../url.js'
import { stat } from 'fs/promises'

let baseModel = await loadImageModel({
  spec: PreTrainedImageModels.mobilenet['mobilenet-v3-large-100'],
  dir: 'saved_model/base_model',
})

async function newModel() {
  let classifierModel = tf.sequential()

  // input shape: 2x1280
  classifierModel.add(tf.layers.inputLayer({ inputShape: [2, 1280] }))
  // layer shape: 2x1280 -> 2560
  classifierModel.add(tf.layers.flatten())
  // layer shape: 2560 -> 256
  classifierModel.add(tf.layers.dense({ units: 256, activation: 'gelu' }))
  // layer shape: 256 -> 32
  classifierModel.add(tf.layers.dense({ units: 32, activation: 'gelu' }))
  // layer shape: 32 -> 1
  classifierModel.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }))

  classifierModel.compile({
    optimizer: tf.train.adam(),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy'],
  })

  let xs = []
  let ys = []
  for (let row of proxy.annotation) {
    let a = new Float32Array(row.a_image!.embedding.buffer)
    let b = new Float32Array(row.b_image!.embedding.buffer)
    xs.push([a, b])
    ys.push([row.is_similar ? 1 : 0])
  }

  if (xs.length > 0) {
    let x = tf.tensor(xs)
    let y = tf.tensor(ys)

    await classifierModel.fit(x, y, {
      epochs: 5,
      verbose: 0,
      callbacks: {
        onEpochEnd(epoch, logs) {
          let accuracy = logs?.acc
          let loss = logs?.loss
          console.log({ epoch, accuracy, loss })
        },
      },
    })
  }

  return classifierModel
}
let classifierModel = await newModel()

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
  width: var(--size);
  height: var(--size);
  display: flex;
  flex-direction: column;
}
.image-item img {
  max-width: 100%;
  max-height: 100%;
  margin: auto;
}
.similarity-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.similarity-info--text {
  text-align: end;
  width: fit-content;
}
.similarity-info--buttons {
  display: flex;
  gap: 0.5rem;
}
`)

let script = Script(/* js */ `
function markSimilar(is_similar) {
  let [a_image_id, b_image_id] = Array.from(
    document.body.querySelectorAll('[data-image-id]'),
    node => node.dataset.imageId,
  )
  let scan_dir = document.querySelector('input[name="scan_dir"]')?.value
  console.log({ a_image_id, b_image_id, scan_dir, is_similar })
  emit('/similar/add/submit', {
    a_image_id,
    b_image_id,
    is_similar,
    scan_dir,
  })
}
window.markSimilar = markSimilar

if (!window.markSimilarByKeyboard) {
  window.markSimilarByKeyboard = true
  console.log('attach keypress listener')
  window.addEventListener('keypress', (event) => {
    if (event.key === '1') {
      window.markSimilar(1)
    } else if (event.key === '2') {
      window.markSimilar(0)
    }
  })
}
`)

type Image = {
  id: number
  file: string
  filename: string
  size: number
  embedding: tf.Tensor
}

// file -> Image
let imageCache = new Map<string, Image>()
async function getImage(file: string): Promise<Image> {
  let cached = imageCache.get(file)
  if (cached) {
    return cached
  }
  let row = find(proxy.image, { file })
  if (row) {
    let buffer = row.embedding
    let float32Array = new Float32Array(buffer.buffer)
    let tensor = tf.tensor(float32Array, [1, 1280])
    let image: Image = {
      id: row.id!,
      file,
      filename: basename(file),
      size: (await stat(file)).size,
      embedding: tensor,
    }
    imageCache.set(file, image)
    return image
  }
  let embedding = await baseModel.imageFileToEmbedding(file)
  let id = proxy.image.push({
    file,
    embedding: Buffer.from((await embedding.data()).buffer),
  })
  let image: Image = {
    id,
    file,
    filename: basename(file),
    size: (await stat(file)).size,
    embedding,
  }
  imageCache.set(file, image)
  return image
}

// scan_dir -> Image[]
let imagesCache = new Map<string, Image[]>()
async function scanImages(dir: string): Promise<Image[]> {
  let cached = imagesCache.get(dir)
  if (cached) {
    return cached
  }

  let filenames = readdirSync(dir)

  let images: Image[] = []

  for (let filename of filenames) {
    if (
      !(
        filename.endsWith('.jpg') ||
        filename.endsWith('.png') ||
        filename.endsWith('.jpeg')
      )
    ) {
      continue
    }
    let file = join(dir, filename)
    let image = await getImage(file)
    images.push(image)
  }

  imagesCache.set(dir, images)
  return images
}

function findSimilar(images: Image[]) {
  images.sort((a, b) => a.id - b.id)
  let n = images.length
  let result = {
    a: images[0],
    b: images[0],
    similarity: -Infinity,
  }
  let start = Date.now()
  for (let i = 0; i < n; i++) {
    let p = ((i / n) * 100).toFixed(2)
    process.stdout.write(`\r> findSimilar: (${i + 1}/${n}) ${p}%`)
    let elapsed = Date.now() - start
    if (elapsed > 1000) {
      break
    }
    let a = images[i]
    for (let j = i + 1; j < n; j++) {
      let b = images[j]
      let has_annotation = count(proxy.annotation, {
        a_image_id: a.id,
        b_image_id: b.id,
      })
      if (has_annotation) {
        continue
      }
      let newSimilar = calculateSimilarity(a, b)
      if (newSimilar > result.similarity) {
        result = { a, b, similarity: newSimilar }
      }
    }
  }
  process.stdout.write(`\n`)
  return result
}

function calculateSimilarity(a: Image, b: Image) {
  let x = tf.stack([a.embedding.concat(b.embedding)])
  let y = classifierModel.predict(x) as tf.Tensor
  let data = y.dataSync()
  return data[0]
}

function Page(
  attrs: {
    scan_dir: string | null
    images: Image[]
  },
  context: DynamicContext,
) {
  let { scan_dir, images } = attrs
  function renderImage(image: Image) {
    let params = new URLSearchParams({ file: image.file })
    return (
      <div class="image-item" data-image-id={image.id}>
        <div>
          #{image.id} {image.filename} ({format_byte(image.size)})
        </div>
        <img src={`/image?${params}`} />
      </div>
    )
  }

  function renderImageList() {
    if (!scan_dir) return null
    let result = findSimilar(images)
    return (
      <>
        {style}
        <div id="Similar">
          <h1>{pageTitle}</h1>

          <h2>Images</h2>
          <div class="image-list">
            {renderImage(result.a)}
            <div class="similarity-info">
              <div class="similarity-info--text">
                <div>Similarity: {result.similarity.toFixed(3)}</div>
                <div>Distance: {(1 - result.similarity).toFixed(3)}</div>
              </div>
              <div class="similarity-info--buttons">
                <button onclick="markSimilar(true)">[1] Similar</button>
                <button onclick="markSimilar(false)">[2] Not Similar</button>
              </div>
            </div>
            {renderImage(result.b)}
          </div>
        </div>
        {script}
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
  a_image_id: id(),
  b_image_id: id(),
  is_similar: boolean(),
  scan_dir: string(),
})

function Submit(attrs: {}, context: DynamicContext) {
  try {
    let body = getContextFormBody(context)
    let input = submitParser.parse(body)
    let [a_image_id, b_image_id] =
      input.a_image_id < input.b_image_id
        ? [input.a_image_id, input.b_image_id]
        : [input.b_image_id, input.a_image_id]
    let id = seedRow(
      proxy.annotation,
      { a_image_id, b_image_id },
      { is_similar: input.is_similar },
    )
    newModel().then(model => {
      imagesCache.clear()
      classifierModel = model
    })
    return (
      <Redirect
        href={toRouteUrl(routes, '/similar', {
          query: { scan_dir: input.scan_dir },
        })}
      />
    )
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
    file = resolve(file)
    res.sendFile(file)
  })
}

let routes = {
  '/similar': {
    menuText: pageTitle,
    async resolve(context) {
      let params = new URLSearchParams(context.routerMatch?.search)
      let scan_dir = params.get('scan_dir')
      let images: Image[] = []
      if (scan_dir) {
        images = await scanImages(scan_dir)
      }
      return {
        title: <Title t={pageTitle} />,
        description: 'TODO',
        node: <Page scan_dir={scan_dir} images={images} />,
      }
    },
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
