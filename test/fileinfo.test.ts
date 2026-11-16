import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileMime, fileNameOf } from '../src/lib/fileinfo.ts'

test('fileMime prefers the real mimetype', () => {
  assert.equal(fileMime('documentMessage', 'application/pdf', 'doc.pdf'), 'application/pdf')
})

test('fileMime maps code extensions sent as octet-stream', () => {
  assert.equal(fileMime('documentMessage', 'application/octet-stream', 'index.js'), 'text/javascript')
  assert.equal(fileMime('documentMessage', undefined, 'main.ts'), 'text/plain')
  assert.equal(fileMime('documentMessage', 'application/octet-stream', 'data.json'), 'application/json')
})

test('fileMime falls back per media type', () => {
  assert.equal(fileMime('imageMessage'), 'image/jpeg')
  assert.equal(fileMime('documentMessage'), 'application/octet-stream')
})

test('fileNameOf keeps the original name', () => {
  assert.equal(fileNameOf('documentMessage', 'text/javascript', 'index.js'), 'index.js')
})

test('fileNameOf invents a usable name without one', () => {
  assert.equal(fileNameOf('imageMessage'), 'image.jpg')
  assert.equal(fileNameOf('documentMessage', 'text/plain'), 'file.txt')
})
