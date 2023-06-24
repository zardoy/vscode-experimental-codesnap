import * as vscode from 'vscode'

import { getExtensionSetting, registerExtensionCommand } from 'vscode-framework'
import Jimp from 'jimp'
import { resolve, join } from 'path'
import screenshot from 'screenshot-desktop'
import * as fs from 'fs'
import * as piexifjs from 'piexifjs'

const SOFTWARE_MARKER = 'special-codesnap'

export const activate = () => {
    let dir: string | undefined
    registerExtensionCommand('captureScreen', async () => {
        const editor = vscode.window.activeTextEditor
        if (!editor) return

        let savePath = getExtensionSetting('overridePath')
        if (!savePath) {
            dir = getExtensionSetting('overrideDir')
            dir ||= await vscode.window.showInputBox({ title: 'Enter dir to save' })
            if (!dir) return
            dir = resolve(dir)

            const files = fs.readdirSync(dir)
            const lastEntry = +(
                files
                    .map(x => x.match(/^(\d+)\.(png|jpg)$/)?.[1])
                    .filter(Boolean)
                    //@ts-ignore
                    .sort((a, b) => a - b)
                    .at(-1) ?? '0'
            )
            const newFileEntry = `${lastEntry + 1}.jpg`
            savePath = join(dir!, newFileEntry)
        }

        return screenshot({ format: 'jpeg' }).then((_buffer: Buffer) => {
            const newBuffer = piexifjs.insert(
                piexifjs.dump({
                    // exif: {
                    // [piexif.ExifIFD.UserComment]:
                    // },
                    '0th': {
                        [piexifjs.TagValues.ImageIFD.Software]: SOFTWARE_MARKER,
                        [piexifjs.TagValues.ImageIFD.ImageDescription]: encodeNonAsciiText(editor.document.getText()),
                    },
                }),
                _buffer.toString('binary'),
            )
            const { x = 0, y = 0, xFromEnd = 0, yFromEnd = 0 } = getExtensionSetting('cropBounds') ?? {}
            Jimp.read(Buffer.from(newBuffer, 'binary'), (err, lenna) => {
                if (err) throw err
                const start = {
                    x,
                    y,
                }
                const end = {
                    x: xFromEnd,
                    y: yFromEnd,
                }
                lenna.crop(start.x, start.y, lenna.bitmap.width - start.x - end.x, lenna.bitmap.height - start.y - end.y).write(savePath)
            })
        })
    })

    vscode.languages.registerDocumentDropEditProvider(['*'], {
        async provideDocumentDropEdits(document, position, dataTransfer, token) {
            const image = dataTransfer.get('image/jpeg') || dataTransfer.get('image/png')
            if (!image) return
            const file = await image.asFile()?.data()
            if (!file) return
            // todo?
            const data = piexifjs.load(Buffer.from(file).toString('binary'))['0th']
            if (!data || data[piexifjs.TagValues.ImageIFD.Software] !== SOFTWARE_MARKER) return
            const text = data[piexifjs.TagValues.ImageIFD.ImageDescription]
            if (typeof text !== 'string') return
            return {
                insertText: unescape(text),
            }
        },
    })
}

const encodeNonAsciiText = (text: string) => {
    return text.replaceAll(/[^\x00-\x7F]+/g, text => {
        return escape(text)
    })
}
