import { httpServerHandler } from 'cloudflare:node'
import { createReceiptServer } from '../src/index.ts'

export default httpServerHandler(createReceiptServer({ basePath: '/' }))
