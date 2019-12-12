import * as express from 'express'
import * as expressWinston from 'express-winston'
import * as cors from 'cors'
import { promisify } from 'util'
import { pipeline } from 'stream'
import { Config, logger } from './config'
import { GaiaDiskReader } from './server'

const pipelineAsync = promisify(pipeline)

export function makeHttpServer(config: Config) {
  const app = express()
  const server = new GaiaDiskReader(config)

  app.use(expressWinston.logger({
    winstonInstance: logger
  }))

  app.use(cors({
    origin: '*', 
    // Set the Access-Control-Max-Age header to 24 hours.
    maxAge: 86400, 
    methods: 'GET,HEAD,OPTIONS',
    // Expose ETag http response header to client
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Expose-Headers
    exposedHeaders: ['ETag']
  }))

  const fileHandler = async (req: express.Request, res: express.Response) => {
    try {
      let filename = req.params[1]
      if (filename.endsWith('/')) {
        filename = filename.substring(0, filename.length - 1)
      }
      const address = req.params[0]

      if (config.cacheControl) {
        res.set('Cache-Control', config.cacheControl)
      }

      const isGetRequest = req.method === 'GET'

      const fileInfo = await server.handleGet(address, filename, isGetRequest)

      if (!fileInfo.exists) {
        return res.status(404).send('File not found')
      }

      res.set({
        'content-type': fileInfo.contentType,
        'etag': fileInfo.etag,
        'last-modified': fileInfo.lastModified.toUTCString(),
        'content-length': fileInfo.contentLength
      })

      if (isGetRequest) {
        await pipelineAsync(fileInfo.fileReadStream, res)
      }
      res.end()
    } catch(err) {
      logger.error(err)
      return res.status(400).send('Could not return file')
    }
  }

  const bucketFilePath = /\/([a-zA-Z0-9-_]+)\/(.+)/
  app.get(bucketFilePath, fileHandler)
  app.head(bucketFilePath, fileHandler)

  return app
}

