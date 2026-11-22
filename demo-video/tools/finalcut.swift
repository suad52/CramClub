// Renders the demo's final cut from an edit decision list (EDL): shot clips re-cut on one
// timeline, cross-dissolves, gentle push-ins, blurred rects, a picture-in-picture video, burned-in
// subtitles (+ a .srt), fades from/to black, and voice pieces mixed into a stereo AAC track.
// Only macOS frameworks: AVFoundation, Core Image (Metal), Core Text, AppKit (fonts). No ffmpeg.
// Build once:  swiftc -O -swift-version 5 finalcut.swift -o bin/finalcut
//
//   finalcut <edl.json> [--plan] [--preview] [--nosubs] [--out path] [--range a,b]
//            [--frames t1,t2,... --frames-dir dir]
//
//   --plan     prints the timeline as JSON ({ duration, frames, segments: [{ i, clip, start, end }],
//              overlays: [...] }) and renders nothing.
//   --preview  renders at half size (960x540) and a third of the bitrate, quickly, for iteration.
//              Without --out it writes <output.path minus .mp4>-preview.mp4 so the final is kept.
//   --nosubs   no burned-in subtitles (the .srt is still written).
//   --out      output path (relative to the current directory). A matching sidecar .srt (shifted
//              and trimmed to --range) is written next to it, in addition to output.srt.
//   --range    renders only timeline seconds [a, b) (exactly what the full render shows there,
//              fades and all): for checking one stretch quickly. --frames times stay timeline times.
//   --frames   after rendering, writes a PNG of the OUTPUT file at each timeline time into
//              --frames-dir (default: next to the output), named t<time>.png (time as %.2f).
//
// Paths inside the EDL are relative to the demo-video folder: the folder two levels above this
// binary (tools/bin/finalcut -> demo-video), unless the EDL has "base" (relative to the EDL file)
// or FINALCUT_BASE is set. Times are seconds. The EDL is JSON; // comments and trailing commas are
// accepted (JSON5).
//
// EDL
// {
//   "output": { "path": "demo-final.mp4", "srt": "demo-final.srt", "width": 1920, "height": 1080,
//               "fps": 30, "videoBitrate": 10000000, "burnSubtitles": true },
//       defaults: path demo-final.mp4, srt = path with .srt, 1920x1080, 30 fps, 10 Mbit/s, burn on.
//   "fadeIn": 0.5,     from black at the start, video (eased) and audio (linear). Default 0.
//   "fadeOut": 1.0,    to black at the end; the last frame is black. Default 0.
//   "segments": [      laid end to end in order on ONE timeline
//     { "clip": "clips/03-walk-in.mp4",
//       "in": 6.5, "out": 12.8,      clip seconds, rounded to whole output frames. Defaults 0 / clip end.
//       "speed": 1.0,                timeline duration = (out - in) / speed, rounded to whole frames
//       "transitionIn": { "type": "dissolve", "frames": 8 },
//           optional. Overlaps the previous segment's last N frames (the timeline gets N frames
//           shorter). Overlap frame j (0..N-1) shows the new segment at (j+1)/(N+1), so there are N
//           true mixes and no duplicated frame. "dip" fades through black instead. Omitted = cut.
//           Two transitions may not overlap each other: N(i) + N(i+1) <= duration of segment i.
//       "zoom": { "from": { "scale": 1.0, "cx": 0.5, "cy": 0.5 },
//                 "to":   { "scale": 1.06, "cx": 0.55, "cy": 0.45 }, "ease": "inOut" },
//           optional push-in over the whole segment (first frame = from, last frame = to). cx/cy =
//           normalized focus point (0,0 = top left); the window is kept inside the frame, so no
//           edge ever shows. scale >= 1. ease: linear | in | out | inOut (sine, default). "to"
//           fields default to "from"'s, "from" defaults to { 1, 0.5, 0.5 }.
//       "blur": [ { "x": 1218, "y": 740, "w": 247, "h": 35, "from": 0, "to": 99 } ]
//           optional Gaussian blur rects in source pixels (y down), active for segment-relative
//           timeline seconds [from, to) (defaults: whole segment). The edge is feathered a few px.
//           Optional "radius" (sigma, px; default clamp(0.35 * min(w,h), 8, 40)).
//     } ],
//   "overlays": [      optional picture-in-picture video, drawn over the segments
//     { "clip": "clips/selfie.mov", "start": 31.0, "end": 37.0, "clipIn": 0.0,
//           timeline [start, end), rounded to frames; clipIn = clip second shown at "start".
//       "timeMap": [[31.0, 0.4], [37.0, 6.4]],
//           optional explicit timeline->clip time pairs (linear between, held before the first and
//           after the last pair); overrides clipIn. Clip time must not run backwards.
//       "rect": { "x": 1440, "y": 80, "w": 400, "h": 711 },   output pixels, y down; aspect-fill
//       "cornerRadius": 28, "fade": 0.25,                       defaults 28 and 0.25 s (in and out)
//       "srcRect": { "x": 1700, "y": 846, "w": 204, "h": 224 },
//           optional: show only this part of the clip (source pixels after rotation, y down),
//           e.g. a magnifier on a small corner of a screen recording. Scaled up with Lanczos.
//       "label": "Your camera" } ],   optional small caption pill centred under the PiP
//           The clip's rotation (preferredTransform, e.g. portrait phone video) is applied.
//           The PiP has a soft shadow and a thin cream rim, and eases in from 96 % size.
//   "audio": [         voice pieces placed on the timeline; outside them the timeline is silent
//     { "file": "frames/final/voice-clean.wav", "in": 0.9, "out": 4.0, "at": 0.8, "gain": 1.0,
//       "fadeIn": 0.03, "fadeOut": 0.08 } ],
//           file seconds [in, out) placed at timeline "at", times gain, linear fades (defaults
//           0.01 s each, against clicks). Mono files are centred with a -3 dB pan law (the same
//           signal at 0.7071 in L and R), so a mono file normalised to -16 LUFS also measures
//           -16 LUFS as stereo (BS.1770 sums the channels). Pieces may overlap (they add). The
//           result is clamped to +-1 (peak reported).
//   "subtitles": [
//     { "start": 0.9, "end": 2.2, "text": "Studying alone is hard.", "position": "bottom",
//       "offsetY": 0 } ]
//           shown on frames with start <= t < end, 4-frame fade in/out. Back-to-back cues at the
//           same position (the next starts within 3 frames of this one's end) swap in place: no
//           fade between them and no empty frames, so a sentence split over cues doesn't blink
//           (the .srt keeps the EDL times). Cram Club style: cream
//           #f4efe4 SF Pro Rounded semibold 44 px (line height 1.25) on a walnut #1f1a16 pill at
//           90 % (PiP labels 80 %), soft shadow, max 1300 px wide, balanced wrap to at most 2 lines (the font steps
//           down to 38 px before a third line is allowed). "\n" forces a break. position bottom:
//           pill bottom 70 px above the frame edge; top: pill top 70 px below the top edge;
//           offsetY px moves it up (+) or down (-).
// }
//
// Output: H.264 High, output.width x output.height, constant fps (frame k stamped k/fps), BT.709
// tags, output.videoBitrate; AAC-LC 48 kHz stereo 192 kbit/s. The .srt (HH:MM:SS,mmm, with the
// same line breaks as the burned-in text) is written on every render, even with --nosubs.
//
// How it works: one AVMutableComposition with two alternating video tracks (A/B, so a dissolve
// has both sources) plus one track per overlay; speed and time maps via scaleTimeRange. A custom
// AVVideoCompositing compositor renders every output frame with Core Image on Metal (colour
// management off, so pixel values pass through untouched). AVAssetReaderVideoCompositionOutput
// pulls the frames; the audio is decoded and mixed sample-accurately in memory (not with an
// AVAudioMix); both go to one AVAssetWriter.
import AppKit
import AVFoundation
import CoreImage
import CoreText
import Foundation
import ImageIO
import Metal
import UniformTypeIdentifiers

setvbuf(stdout, nil, _IOLBF, 0)

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write(("finalcut: " + msg + "\n").data(using: .utf8)!)
    exit(1)
}

final class Warnings {
    static let lock = NSLock()
    static var list: [String] = []
    static func add(_ msg: String) {
        lock.lock()
        list.append(msg)
        lock.unlock()
        FileHandle.standardError.write(("warning: " + msg + "\n").data(using: .utf8)!)
    }
}

func warn(_ msg: String) { Warnings.add(msg) }
func note(_ msg: String) { FileHandle.standardError.write((msg + "\n").data(using: .utf8)!) }

/// Seconds rounded to milliseconds, as a decimal so the JSON reads 27.3, not 27.300000000000001.
func r3(_ x: Double) -> NSDecimalNumber { NSDecimalNumber(string: String(format: "%.3f", x)) }
func clamp(_ x: Double, _ a: Double, _ b: Double) -> Double { min(max(x, a), b) }

// MARK: - EDL model

struct EDL: Decodable {
    struct Output: Decodable {
        var path: String?
        var srt: String?
        var width: Int?
        var height: Int?
        var fps: Int?
        var videoBitrate: Int?
        var burnSubtitles: Bool?
    }
    struct ZoomPoint: Decodable {
        var scale: Double?
        var cx: Double?
        var cy: Double?
    }
    struct Zoom: Decodable {
        var from: ZoomPoint?
        var to: ZoomPoint?
        var ease: String?
    }
    struct Blur: Decodable {
        var x: Double
        var y: Double
        var w: Double
        var h: Double
        var from: Double?
        var to: Double?
        var radius: Double?
    }
    struct Transition: Decodable {
        var type: String?
        var frames: Int?
    }
    struct Segment: Decodable {
        var clip: String
        var inPoint: Double?
        var outPoint: Double?
        var speed: Double?
        var transitionIn: Transition?
        var zoom: Zoom?
        var blur: [Blur]?
        enum CodingKeys: String, CodingKey {
            case clip, speed, transitionIn, zoom, blur
            case inPoint = "in"
            case outPoint = "out"
        }
    }
    struct Rect: Decodable {
        var x: Double
        var y: Double
        var w: Double
        var h: Double
    }
    struct Overlay: Decodable {
        var clip: String
        var start: Double
        var end: Double
        var clipIn: Double?
        var timeMap: [[Double]]?
        var rect: Rect
        var cornerRadius: Double?
        var fade: Double?
        var label: String?
        var srcRect: Rect?
    }
    struct Audio: Decodable {
        var file: String
        var inPoint: Double?
        var outPoint: Double?
        var at: Double
        var gain: Double?
        var fadeIn: Double?
        var fadeOut: Double?
        enum CodingKeys: String, CodingKey {
            case file, at, gain, fadeIn, fadeOut
            case inPoint = "in"
            case outPoint = "out"
        }
    }
    struct Subtitle: Decodable {
        var start: Double
        var end: Double
        var text: String
        var position: String?
        var offsetY: Double?
    }
    var base: String?
    var output: Output?
    var fadeIn: Double?
    var fadeOut: Double?
    var segments: [Segment]
    var overlays: [Overlay]?
    var audio: [Audio]?
    var subtitles: [Subtitle]?
}

// MARK: - command line

var args = Array(CommandLine.arguments.dropFirst())
func takeOpt(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    let v = args[i + 1]
    args.removeSubrange(i...(i + 1))
    return v
}
func takeFlag(_ name: String) -> Bool {
    guard let i = args.firstIndex(of: name) else { return false }
    args.remove(at: i)
    return true
}
let planOnly = takeFlag("--plan")
let preview = takeFlag("--preview")
let noSubs = takeFlag("--nosubs")
let outOpt = takeOpt("--out")
let rangeOpt = takeOpt("--range")
let framesOpt = takeOpt("--frames")
let framesDirOpt = takeOpt("--frames-dir")
guard args.count == 1, !args[0].hasPrefix("--") else {
    fail("usage: finalcut <edl.json> [--plan] [--preview] [--nosubs] [--out path] [--range a,b] [--frames t1,t2 --frames-dir dir]")
}
let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
let edlURL = URL(fileURLWithPath: args[0], relativeTo: cwd).standardizedFileURL

let edl: EDL
do {
    let data = try Data(contentsOf: edlURL)
    let dec = JSONDecoder()
    dec.allowsJSON5 = true
    edl = try dec.decode(EDL.self, from: data)
} catch {
    fail("cannot read \(edlURL.path): \(error)")
}
guard !edl.segments.isEmpty else { fail("the EDL has no segments") }

let baseURL: URL = {
    if let b = edl.base { return URL(fileURLWithPath: b, isDirectory: true, relativeTo: edlURL.deletingLastPathComponent()).standardizedFileURL }
    if let b = ProcessInfo.processInfo.environment["FINALCUT_BASE"] { return URL(fileURLWithPath: b, isDirectory: true, relativeTo: cwd).standardizedFileURL }
    if let exe = Bundle.main.executableURL?.resolvingSymlinksInPath() {
        let root = exe.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        if FileManager.default.fileExists(atPath: root.appendingPathComponent("clips").path) { return root }
    }
    return cwd
}()
func resolve(_ p: String) -> URL { URL(fileURLWithPath: p, relativeTo: baseURL).standardizedFileURL }

// MARK: - settings

let fps = edl.output?.fps ?? 30
let fpsD = Double(fps)
let designW = Double(edl.output?.width ?? 1920)
let designH = Double(edl.output?.height ?? 1080)
let designRect = CGRect(x: 0, y: 0, width: designW, height: designH)
let renderScale = preview ? 0.5 : 1.0
let renderW = Int((designW * renderScale / 2).rounded()) * 2
let renderH = Int((designH * renderScale / 2).rounded()) * 2
let bitrate = max(500_000, (edl.output?.videoBitrate ?? 10_000_000) / (preview ? 3 : 1))
let burnSubs = (edl.output?.burnSubtitles ?? true) && !noSubs
let audioRate = 48000

let outPathEDL = edl.output?.path ?? "demo-final.mp4"
let outURL: URL = {
    if let o = outOpt { return URL(fileURLWithPath: o, relativeTo: cwd).standardizedFileURL }
    let u = resolve(outPathEDL)
    if preview { return u.deletingLastPathComponent().appendingPathComponent(u.deletingPathExtension().lastPathComponent + "-preview.mp4") }
    return u
}()
let srtURL = resolve(edl.output?.srt ?? ((outPathEDL as NSString).deletingPathExtension + ".srt"))

// EDL times come rounded to the millisecond, so a time within 0.02 frame of a frame boundary means
// that frame (19.667 s is frame 590, not 591).
func frameAtOrAfter(_ t: Double) -> Int { Int((t * fpsD - 0.02).rounded(.up)) }
func frameNearest(_ t: Double) -> Int { Int((t * fpsD).rounded()) }
func tl(_ frames: Int) -> CMTime { CMTime(value: CMTimeValue(frames), timescale: CMTimeScale(fps)) }
func secs(_ s: Double) -> CMTime { CMTime(seconds: s, preferredTimescale: 600_000) }

// MARK: - sources

final class Source {
    let url: URL
    let asset: AVURLAsset
    let track: AVAssetTrack
    let range: CMTimeRange
    let natural: CGSize
    let transform: CGAffineTransform
    let oriented: CGSize
    var duration: Double { range.duration.seconds }
    init(url: URL, asset: AVURLAsset, track: AVAssetTrack, range: CMTimeRange, natural: CGSize, transform: CGAffineTransform) {
        self.url = url
        self.asset = asset
        self.track = track
        self.range = range
        self.natural = natural
        self.transform = transform
        let r = CGRect(origin: .zero, size: natural).applying(transform)
        oriented = CGSize(width: abs(r.width).rounded(), height: abs(r.height).rounded())
    }
}

var sourceCache: [String: Source] = [:]
func loadSource(_ path: String) async -> Source {
    if let s = sourceCache[path] { return s }
    let url = resolve(path)
    guard FileManager.default.fileExists(atPath: url.path) else { fail("missing clip \(url.path)") }
    let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    do {
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { fail("\(path): no video track") }
        let (range, natural, transform) = try await track.load(.timeRange, .naturalSize, .preferredTransform)
        let s = Source(url: url, asset: asset, track: track, range: range, natural: natural, transform: transform)
        sourceCache[path] = s
        return s
    } catch {
        fail("\(path): \(error)")
    }
}

/// Applies a track's preferredTransform (defined y-down) to a Core Image frame (y-up), so the
/// result is upright with its extent at the origin.
func orient(_ img: CIImage, _ src: Source) -> CIImage {
    if src.transform.isIdentity { return img }
    let h = src.natural.height
    let flipIn = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: h)
    let flipOut = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: src.oriented.height)
    let t = flipIn.concatenating(src.transform).concatenating(flipOut)
    var out = img.transformed(by: t)
    let e = out.extent
    out = out.transformed(by: CGAffineTransform(translationX: -e.origin.x.rounded(), y: -e.origin.y.rounded()))
    return out
}

// MARK: - text pills (subtitles and labels), drawn once with Core Text

struct PillStyle {
    var fontSize: CGFloat
    var minFontSize: CGFloat
    var lineHeight: CGFloat = 1.25
    var padX: CGFloat
    var padY: CGFloat
    var radius: CGFloat          // capped at half the pill height
    var maxWidth: CGFloat
    var maxLines: Int
    var shadowBlur: CGFloat = 18
    var shadowDY: CGFloat = 5
    var shadowAlpha: CGFloat = 0.35
    var fillAlpha: CGFloat = 0.8
}

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: sRGB, components: [CGFloat((hex >> 16) & 0xff) / 255, CGFloat((hex >> 8) & 0xff) / 255, CGFloat(hex & 0xff) / 255, a])!
}
// Cram Club tokens (apps/web/app/globals.css): --color-walnut #1f1a16, --color-walnut-text #f4efe4,
// --color-surface #fffefa.
let walnut: UInt32 = 0x1F1A16
let walnutText: UInt32 = 0xF4EFE4
let surface: UInt32 = 0xFFFEFA

func roundedFont(_ size: CGFloat, _ weight: NSFont.Weight = .semibold) -> CTFont {
    let base = NSFont.systemFont(ofSize: size, weight: weight)
    if let d = base.fontDescriptor.withDesign(.rounded), let f = NSFont(descriptor: d, size: size) { return f as CTFont }
    return base as CTFont
}

struct TextLine {
    let line: CTLine
    let text: String
    let width: CGFloat
}

func breakLines(_ s: String, _ font: CTFont, _ color: CGColor, width: CGFloat) -> [TextLine] {
    let attr = NSAttributedString(string: s, attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    ])
    let ts = CTTypesetterCreateWithAttributedString(attr)
    let ns = s as NSString
    var start = 0
    var lines: [TextLine] = []
    while start < ns.length {
        let count = max(1, CTTypesetterSuggestLineBreak(ts, start, Double(width)))
        let line = CTTypesetterCreateLine(ts, CFRange(location: start, length: count))
        let w = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil) - CTLineGetTrailingWhitespaceWidth(line))
        let text = ns.substring(with: NSRange(location: start, length: count)).trimmingCharacters(in: .whitespaces)
        lines.append(TextLine(line: line, text: text, width: w))
        start += count
    }
    return lines
}

/// Breaks a paragraph into as few lines as fit maxWidth, then narrows the width as far as that
/// line count allows, so a two-line subtitle has two lines of similar length.
func balancedLines(_ s: String, _ font: CTFont, _ color: CGColor, maxWidth: CGFloat) -> [TextLine] {
    let full = breakLines(s, font, color, width: maxWidth)
    if full.count <= 1 { return full }
    var lo = maxWidth / CGFloat(full.count) * 0.8
    var hi = maxWidth
    for _ in 0..<16 {
        let mid = (lo + hi) / 2
        if breakLines(s, font, color, width: mid).count <= full.count { hi = mid } else { lo = mid }
    }
    return breakLines(s, font, color, width: hi)
}

struct Pill {
    let image: CGImage
    let pill: CGRect       // the pill inside the image, CG coordinates (y up)
    let lines: [String]
    let fontSize: CGFloat
}

func makePill(_ text: String, _ st: PillStyle) -> Pill {
    let color = rgb(walnutText)
    var size = st.fontSize
    var font = roundedFont(size)
    var lines: [TextLine] = []
    while true {
        font = roundedFont(size)
        lines = text.components(separatedBy: "\n").flatMap { balancedLines($0, font, color, maxWidth: st.maxWidth) }
        if lines.count <= st.maxLines || size - 2 < st.minFontSize { break }
        size -= 2
    }
    if lines.count > st.maxLines { warn("subtitle needs \(lines.count) lines even at \(Int(size)) px: \"\(text)\"") }
    let lineH = (size * st.lineHeight).rounded()
    let textW = lines.map(\.width).max() ?? 0
    let pillW = (textW + 2 * st.padX).rounded(.up)
    let pillH = CGFloat(lines.count) * lineH + 2 * st.padY
    let margin = (st.shadowBlur * 1.5 + st.shadowDY + 4).rounded(.up)
    let w = Int(pillW + 2 * margin), h = Int(pillH + 2 * margin)
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("cannot make a text bitmap") }
    let pill = CGRect(x: margin, y: margin, width: pillW, height: pillH)
    let r = min(st.radius, pillH / 2)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -st.shadowDY), blur: st.shadowBlur, color: rgb(0x000000, st.shadowAlpha))
    ctx.addPath(CGPath(roundedRect: pill, cornerWidth: r, cornerHeight: r, transform: nil))
    ctx.setFillColor(rgb(walnut, st.fillAlpha))
    ctx.fillPath()
    ctx.restoreGState()
    ctx.setShouldAntialias(true)
    ctx.setAllowsFontSmoothing(false)
    ctx.setShouldSmoothFonts(false)
    ctx.setAllowsFontSubpixelPositioning(true)
    ctx.setShouldSubpixelPositionFonts(true)
    let asc = CTFontGetAscent(font), desc = CTFontGetDescent(font)
    for (i, l) in lines.enumerated() {
        let boxTop = pill.maxY - st.padY - CGFloat(i) * lineH
        let baseline = (boxTop - (lineH - (asc + desc)) / 2 - asc).rounded()
        let x = (pill.minX + (pillW - l.width) / 2).rounded()
        ctx.textPosition = CGPoint(x: x, y: baseline)
        CTLineDraw(l.line, ctx)
    }
    guard let img = ctx.makeImage() else { fail("cannot make a text image") }
    return Pill(image: img, pill: pill, lines: lines.map(\.text), fontSize: size)
}

func ciImage(_ cg: CGImage) -> CIImage { CIImage(cgImage: cg, options: [.colorSpace: NSNull()]) }

// MARK: - plan

enum Ease: String { case linear, `in`, out, inOut }
func ease(_ e: Ease, _ u: Double) -> Double {
    let x = clamp(u, 0, 1)
    switch e {
    case .linear: return x
    case .in: return x * x
    case .out: return 1 - (1 - x) * (1 - x)
    case .inOut: return 0.5 - 0.5 * cos(Double.pi * x)
    }
}
func smooth(_ u: Double) -> Double { let x = clamp(u, 0, 1); return x * x * (3 - 2 * x) }

struct ZoomPlan {
    var s0: Double, cx0: Double, cy0: Double
    var s1: Double, cx1: Double, cy1: Double
    var ease: Ease
}

struct BlurPlan {
    let rect: CGRect        // source pixels, y down
    let fromFrame: Int      // segment-relative output frames [from, to)
    let toFrame: Int
    let sigma: Double
}

final class SegPlan {
    let i: Int
    let clip: String
    let src: Source
    let trackID: CMPersistentTrackID
    let inFrame: Int, outFrame: Int     // source frames at the output rate
    let startFrame: Int, durFrames: Int
    let overlap: Int                    // transition frames shared with the previous segment
    let transition: String              // cut | dissolve | dip
    let zoom: ZoomPlan?
    let blurs: [BlurPlan]
    var endFrame: Int { startFrame + durFrames }
    init(i: Int, clip: String, src: Source, trackID: CMPersistentTrackID, inFrame: Int, outFrame: Int, startFrame: Int,
         durFrames: Int, overlap: Int, transition: String, zoom: ZoomPlan?, blurs: [BlurPlan]) {
        self.i = i; self.clip = clip; self.src = src; self.trackID = trackID; self.inFrame = inFrame; self.outFrame = outFrame
        self.startFrame = startFrame; self.durFrames = durFrames; self.overlap = overlap; self.transition = transition
        self.zoom = zoom; self.blurs = blurs
    }
}

final class OverlayPlan {
    let i: Int
    let clip: String
    let src: Source
    let trackID: CMPersistentTrackID
    let startFrame: Int, endFrame: Int
    let rect: CGRect                     // output pixels, y down
    let fadeFrames: Double
    let pieces: [(t0: Int, t1: Int, c0: Double, c1: Double)]
    var srcRect: CGRect?                 // part of the (oriented) clip to show, source pixels, y down
    var mask: CIImage!, rim: CIImage!, shadow: CIImage!, label: CIImage?
    init(i: Int, clip: String, src: Source, trackID: CMPersistentTrackID, startFrame: Int, endFrame: Int, rect: CGRect,
         fadeFrames: Double, pieces: [(t0: Int, t1: Int, c0: Double, c1: Double)]) {
        self.i = i; self.clip = clip; self.src = src; self.trackID = trackID; self.startFrame = startFrame; self.endFrame = endFrame
        self.rect = rect; self.fadeFrames = fadeFrames; self.pieces = pieces
    }
}

final class CuePlan {
    let start: Double, end: Double
    let startFrame: Int
    var endFrame: Int                   // burned-in end; may be held to the next cue's start
    let position: String
    var fadeIn = true, fadeOut = true   // off where back-to-back cues swap in place
    let lines: [String]
    let image: CIImage                  // already placed in output coordinates (y up)
    init(start: Double, end: Double, position: String, lines: [String], image: CIImage) {
        self.start = start; self.end = end; self.position = position; self.lines = lines; self.image = image
        startFrame = frameAtOrAfter(start)
        endFrame = frameAtOrAfter(end)
    }
}

// Segments on the timeline.
var segs: [SegPlan] = []
var cursor = 0
for (i, s) in edl.segments.enumerated() {
    let src = await loadSource(s.clip)
    let maxFrame = Int((src.duration * fpsD + 1e-6).rounded(.down))
    var inF = frameNearest(s.inPoint ?? 0)
    var outF = s.outPoint.map(frameNearest) ?? maxFrame
    if inF < 0 { warn("segment \(i): in < 0, using 0"); inF = 0 }
    if outF > maxFrame { warn("segment \(i) (\(s.clip)): out \(s.outPoint!) is past the clip end \(String(format: "%.3f", src.duration)); using the end"); outF = maxFrame }
    guard outF > inF else { fail("segment \(i) (\(s.clip)): out must be after in") }
    let speed = s.speed ?? 1
    guard speed > 0 else { fail("segment \(i): speed must be > 0") }
    let dur = max(1, Int((Double(outF - inF) / speed).rounded()))
    var overlap = 0
    var transition = "cut"
    if let t = s.transitionIn, i > 0 {
        let type = (t.type ?? "dissolve").lowercased()
        if type == "cut" || (t.frames ?? 0) <= 0 {
            transition = "cut"
        } else {
            transition = (type == "dip") ? "dip" : "dissolve"
            if type != "dissolve" && type != "dip" { warn("segment \(i): unknown transition \(type), using dissolve") }
            overlap = t.frames ?? 8
            let prev = segs[i - 1]
            let room = prev.durFrames - prev.overlap
            if overlap > min(room, dur) {
                fail("segment \(i): a \(overlap)-frame transition does not fit (previous segment has \(room) free frames, this one \(dur))")
            }
        }
    }
    let start = cursor - overlap
    var zoom: ZoomPlan?
    if let z = s.zoom {
        let f = z.from, t = z.to
        let s0 = f?.scale ?? 1, cx0 = f?.cx ?? 0.5, cy0 = f?.cy ?? 0.5
        var zp = ZoomPlan(s0: s0, cx0: cx0, cy0: cy0, s1: t?.scale ?? s0, cx1: t?.cx ?? cx0, cy1: t?.cy ?? cy0,
                          ease: Ease(rawValue: z.ease ?? "inOut") ?? .inOut)
        if Ease(rawValue: z.ease ?? "inOut") == nil { warn("segment \(i): unknown ease \(z.ease!), using inOut") }
        if zp.s0 < 1 || zp.s1 < 1 { warn("segment \(i): zoom scale below 1 would show the frame edge; clamped to 1"); zp.s0 = max(1, zp.s0); zp.s1 = max(1, zp.s1) }
        zoom = zp
    }
    let blurs: [BlurPlan] = (s.blur ?? []).map { b in
        BlurPlan(rect: CGRect(x: b.x, y: b.y, width: b.w, height: b.h),
                 fromFrame: frameAtOrAfter(b.from ?? 0),
                 toFrame: b.to.map(frameAtOrAfter) ?? Int.max,
                 sigma: b.radius ?? clamp(0.35 * min(b.w, b.h), 8, 40))
    }
    let seg = SegPlan(i: i, clip: s.clip, src: src, trackID: CMPersistentTrackID(1 + (i % 2)), inFrame: inF, outFrame: outF,
                      startFrame: start, durFrames: dur, overlap: overlap, transition: transition, zoom: zoom, blurs: blurs)
    segs.append(seg)
    cursor = seg.endFrame
}
let totalFrames = cursor
let totalSeconds = Double(totalFrames) / fpsD

// Overlays.
var overlays: [OverlayPlan] = []
for (i, o) in (edl.overlays ?? []).enumerated() {
    let src = await loadSource(o.clip)
    var s0 = frameNearest(o.start), e0 = frameNearest(o.end)
    if s0 < 0 { s0 = 0 }
    if e0 > totalFrames { warn("overlay \(i): end \(o.end) is past the timeline end \(String(format: "%.3f", totalSeconds)); clipped"); e0 = totalFrames }
    guard e0 > s0 else { warn("overlay \(i): empty, skipped"); continue }
    // Timeline frame -> clip seconds, piecewise linear, held at both ends.
    var pts: [(Int, Double)]
    if let m = o.timeMap, !m.isEmpty {
        pts = m.map { p in
            guard p.count == 2 else { fail("overlay \(i): timeMap entries are [timeline, clip] pairs") }
            return (frameNearest(p[0]), p[1])
        }.sorted { $0.0 < $1.0 }
    } else {
        let c = o.clipIn ?? 0
        pts = [(s0, c), (e0, c + Double(e0 - s0) / fpsD)]
    }
    func clipAt(_ f: Int) -> Double {
        if f <= pts.first!.0 { return pts.first!.1 }
        if f >= pts.last!.0 { return pts.last!.1 }
        for j in 1..<pts.count where f <= pts[j].0 {
            let (a, ca) = pts[j - 1], (b, cb) = pts[j]
            return b == a ? cb : ca + (cb - ca) * Double(f - a) / Double(b - a)
        }
        return pts.last!.1
    }
    var knots = Set([s0, e0])
    for p in pts where p.0 > s0 && p.0 < e0 { knots.insert(p.0) }
    let ks = knots.sorted()
    let srcEnd = src.duration
    var pieces: [(t0: Int, t1: Int, c0: Double, c1: Double)] = []
    for j in 1..<ks.count {
        var c0 = clipAt(ks[j - 1]), c1 = clipAt(ks[j])
        if c1 < c0 - 1e-9 { fail("overlay \(i): the timeMap runs the clip backwards") }
        let maxStart = max(0, srcEnd - 1 / fpsD)
        if c0 > maxStart || c1 > srcEnd + 1e-6 { warn("overlay \(i): clip time \(String(format: "%.3f", max(c0, c1))) is past the clip end \(String(format: "%.3f", srcEnd)); held") }
        c0 = clamp(c0, 0, maxStart)
        c1 = clamp(c1, 0, srcEnd)
        if c1 - c0 < 1 / fpsD { c1 = min(srcEnd, c0 + 1 / fpsD) }    // a hold: one frame stretched
        pieces.append((ks[j - 1], ks[j], c0, c1))
    }
    let r = CGRect(x: o.rect.x, y: o.rect.y, width: o.rect.w, height: o.rect.h)
    let op = OverlayPlan(i: i, clip: o.clip, src: src, trackID: CMPersistentTrackID(10 + i), startFrame: s0, endFrame: e0, rect: r,
                         fadeFrames: max(0, (o.fade ?? 0.25) * fpsD), pieces: pieces)
    if let s = o.srcRect {
        let sr = CGRect(x: s.x, y: s.y, width: s.w, height: s.h)
        let full = CGRect(origin: .zero, size: src.oriented)
        guard sr.width >= 1, sr.height >= 1, full.contains(sr) else {
            fail("overlay \(i): srcRect \(sr) is not inside the clip (\(Int(src.oriented.width))x\(Int(src.oriented.height)))")
        }
        op.srcRect = sr
    }
    if !planOnly { buildOverlayChrome(op, radius: CGFloat(o.cornerRadius ?? 28), label: o.label) }
    overlays.append(op)
}

/// Shadow, rounded mask, rim and label for a PiP, in PiP-local coordinates (origin at the
/// rect's bottom-left, y up), drawn once.
func buildOverlayChrome(_ op: OverlayPlan, radius: CGFloat, label: String?) {
    let w = op.rect.width, h = op.rect.height
    let r = min(radius, min(w, h) / 2)
    func bitmap(_ bw: CGFloat, _ bh: CGFloat, _ draw: (CGContext) -> Void) -> CGImage {
        guard let ctx = CGContext(data: nil, width: Int(bw.rounded(.up)), height: Int(bh.rounded(.up)), bitsPerComponent: 8, bytesPerRow: 0,
                                  space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("bitmap") }
        ctx.setShouldAntialias(true)
        draw(ctx)
        return ctx.makeImage()!
    }
    let box = CGRect(x: 0, y: 0, width: w, height: h)
    op.mask = ciImage(bitmap(w, h) { ctx in
        ctx.addPath(CGPath(roundedRect: box, cornerWidth: r, cornerHeight: r, transform: nil))
        ctx.setFillColor(rgb(0xFFFFFF))
        ctx.fillPath()
    })
    op.rim = ciImage(bitmap(w, h) { ctx in
        let lw: CGFloat = 3
        let inner = box.insetBy(dx: lw / 2, dy: lw / 2)
        ctx.addPath(CGPath(roundedRect: inner, cornerWidth: r - lw / 2, cornerHeight: r - lw / 2, transform: nil))
        ctx.setStrokeColor(rgb(surface, 0.9))
        ctx.setLineWidth(lw)
        ctx.strokePath()
    })
    let m: CGFloat = 60
    op.shadow = ciImage(bitmap(w + 2 * m, h + 2 * m) { ctx in
        ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 34, color: rgb(0x000000, 0.5))
        ctx.addPath(CGPath(roundedRect: box.offsetBy(dx: m, dy: m).insetBy(dx: 2, dy: 2), cornerWidth: r, cornerHeight: r, transform: nil))
        ctx.setFillColor(rgb(0x000000))
        ctx.fillPath()
    }).transformed(by: CGAffineTransform(translationX: -m, y: -m))
    if let label, !label.isEmpty {
        let p = makePill(label, PillStyle(fontSize: 26 * designH / 1080, minFontSize: 20, padX: 18, padY: 7, radius: 100,
                                          maxWidth: max(w, 300), maxLines: 1, shadowBlur: 12, shadowDY: 3, shadowAlpha: 0.3))
        let gap: CGFloat = 16
        let x = ((w - p.pill.width) / 2 - p.pill.minX).rounded()
        let y = (-gap - p.pill.height - p.pill.minY).rounded()
        op.label = ciImage(p.image).transformed(by: CGAffineTransform(translationX: x, y: y))
    }
}

// Subtitles.
let subStyle = PillStyle(fontSize: 44 * designH / 1080, minFontSize: 38 * designH / 1080, padX: 30, padY: 12, radius: 24,
                         maxWidth: 1300 * designW / 1920, maxLines: 2, fillAlpha: 0.9)
var cues: [CuePlan] = []
if !planOnly {
    for (i, s) in (edl.subtitles ?? []).enumerated() {
        guard s.end > s.start else { warn("subtitle \(i) ends before it starts; skipped"); continue }
        let text = s.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { continue }
        let p = makePill(text, subStyle)
        let off = CGFloat(s.offsetY ?? 0)
        let edge: CGFloat = 70 * designH / 1080
        let pillBottom: CGFloat
        var pos = (s.position ?? "bottom").lowercased()
        switch pos {
        case "top": pillBottom = designH - edge - p.pill.height + off
        default:
            if pos != "bottom" { warn("subtitle \(i): position \(s.position!) is not top|bottom; using bottom") }
            pos = "bottom"
            pillBottom = edge + off
        }
        let x = ((designW - p.pill.width) / 2 - p.pill.minX).rounded()
        let y = (pillBottom - p.pill.minY).rounded()
        cues.append(CuePlan(start: s.start, end: s.end, position: pos, lines: p.lines,
                            image: ciImage(p.image).transformed(by: CGAffineTransform(translationX: x, y: y))))
        if s.end > totalSeconds + 1e-6 { warn("subtitle \(i) ends at \(s.end), after the video (\(String(format: "%.3f", totalSeconds)))") }
    }
    cues.sort { $0.start < $1.start }
    // Back-to-back cues at the same position swap in place (no fade dip, no empty frames).
    for j in 0..<max(0, cues.count - 1) {
        let a = cues[j], b = cues[j + 1]
        let gap = b.startFrame - a.endFrame
        if a.position == b.position && gap >= 0 && gap <= 3 {
            a.endFrame = b.startFrame
            a.fadeOut = false
            b.fadeIn = false
        }
    }
}

// MARK: - --plan

if planOnly {
    let plan: [String: Any] = [
        "duration": r3(totalSeconds),
        "frames": totalFrames,
        "fps": fps,
        "segments": segs.map { s -> [String: Any] in
            ["i": s.i, "clip": s.clip, "start": r3(Double(s.startFrame) / fpsD), "end": r3(Double(s.endFrame) / fpsD),
             "in": r3(Double(s.inFrame) / fpsD), "out": r3(Double(s.outFrame) / fpsD), "transition": s.transition, "overlapFrames": s.overlap]
        },
        "overlays": overlays.map { o -> [String: Any] in
            ["i": o.i, "clip": o.clip, "start": r3(Double(o.startFrame) / fpsD), "end": r3(Double(o.endFrame) / fpsD)]
        },
        "subtitles": (edl.subtitles ?? []).count,
        "audioPieces": (edl.audio ?? []).count,
    ]
    let json = try! JSONSerialization.data(withJSONObject: plan, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    print(String(data: json, encoding: .utf8)!)
    exit(0)
}

// MARK: - .srt (every render)

func srtTime(_ t: Double) -> String {
    let ms = max(0, Int((t * 1000).rounded()))
    return String(format: "%02d:%02d:%02d,%03d", ms / 3_600_000, (ms / 60000) % 60, (ms / 1000) % 60, ms % 1000)
}
func writeSRT(_ url: URL, shift: Double = 0, window: (Double, Double)? = nil) {
    var out = ""
    var n = 0
    for c in cues {
        var a = c.start, b = min(c.end, totalSeconds)
        if a >= b { continue }
        if let (w0, w1) = window {
            if b <= w0 || a >= w1 { continue }
            a = max(a, w0); b = min(b, w1)
        }
        n += 1
        out += "\(n)\n\(srtTime(a - shift)) --> \(srtTime(b - shift))\n\(c.lines.joined(separator: "\n"))\n\n"
    }
    do {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try out.write(to: url, atomically: true, encoding: .utf8)
    } catch { fail("cannot write \(url.path): \(error)") }
}
writeSRT(srtURL)

// MARK: - render range

var rangeStartFrame = 0
var rangeEndFrame = totalFrames
if let r = rangeOpt {
    let p = r.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard p.count == 2, p[1] > p[0] else { fail("--range wants a,b (seconds, b > a)") }
    rangeStartFrame = max(0, frameNearest(p[0]))
    rangeEndFrame = min(totalFrames, frameNearest(p[1]))
    guard rangeEndFrame > rangeStartFrame else { fail("--range is outside the timeline (0-\(String(format: "%.3f", totalSeconds)))") }
}
let renderFrames = rangeEndFrame - rangeStartFrame
let rangeStartSec = Double(rangeStartFrame) / fpsD
let sidecarSRT: URL? = outOpt != nil ? outURL.deletingPathExtension().appendingPathExtension("srt") : nil
if let s = sidecarSRT, s.standardizedFileURL != srtURL.standardizedFileURL {
    writeSRT(s, shift: rangeStartSec, window: rangeOpt != nil ? (rangeStartSec, Double(rangeEndFrame) / fpsD) : nil)
}

// MARK: - composition

let comp = AVMutableComposition()
comp.naturalSize = CGSize(width: designW, height: designH)
guard let trackA = comp.addMutableTrack(withMediaType: .video, preferredTrackID: 1),
      let trackB = comp.addMutableTrack(withMediaType: .video, preferredTrackID: 2) else { fail("cannot add video tracks") }
var compTracks: [CMPersistentTrackID: AVMutableCompositionTrack] = [1: trackA, 2: trackB]
var trackEnd: [CMPersistentTrackID: CMTime] = [1: .zero, 2: .zero]

func insert(_ trackID: CMPersistentTrackID, src: Source, clipStart: CMTime, clipDur: CMTime, at: CMTime, toDuration: CMTime, what: String) {
    let t = compTracks[trackID]!
    let end = trackEnd[trackID] ?? .zero
    if CMTimeCompare(end, at) < 0 { t.insertEmptyTimeRange(CMTimeRange(start: end, end: at)) }
    else if CMTimeCompare(end, at) > 0 { fail("\(what): overlaps the previous piece on its track") }
    let srcRange = CMTimeRange(start: CMTimeAdd(src.range.start, clipStart), duration: clipDur)
    do { try t.insertTimeRange(srcRange, of: src.track, at: at) } catch { fail("\(what): insert: \(error)") }
    if CMTimeCompare(clipDur, toDuration) != 0 {
        t.scaleTimeRange(CMTimeRange(start: at, duration: clipDur), toDuration: toDuration)
    }
    trackEnd[trackID] = CMTimeAdd(at, toDuration)
}

for s in segs {
    insert(s.trackID, src: s.src, clipStart: tl(s.inFrame), clipDur: tl(s.outFrame - s.inFrame), at: tl(s.startFrame),
           toDuration: tl(s.durFrames), what: "segment \(s.i) (\(s.clip))")
}
for o in overlays {
    guard let t = comp.addMutableTrack(withMediaType: .video, preferredTrackID: o.trackID) else { fail("cannot add an overlay track") }
    compTracks[o.trackID] = t
    trackEnd[o.trackID] = .zero
    for p in o.pieces {
        insert(o.trackID, src: o.src, clipStart: secs(p.c0), clipDur: secs(p.c1 - p.c0), at: tl(p.t0), toDuration: tl(p.t1 - p.t0),
               what: "overlay \(o.i) (\(o.clip))")
    }
}

final class FCInstruction: NSObject, AVVideoCompositionInstructionProtocol {
    let timeRange: CMTimeRange
    let enablePostProcessing = false
    let containsTweening = true
    let requiredSourceTrackIDs: [NSValue]?
    let passthroughTrackID: CMPersistentTrackID = kCMPersistentTrackID_Invalid
    init(_ range: CMTimeRange, _ ids: [CMPersistentTrackID]) {
        timeRange = range
        requiredSourceTrackIDs = ids.map { NSNumber(value: $0) }
    }
}

// Instructions: split the timeline wherever a segment or overlay starts or ends.
var cuts = Set([0, totalFrames])
for s in segs { cuts.insert(s.startFrame); cuts.insert(s.endFrame) }
for o in overlays { cuts.insert(o.startFrame); cuts.insert(o.endFrame) }
let bounds = cuts.filter { $0 >= 0 && $0 <= totalFrames }.sorted()
var instructions: [FCInstruction] = []
for j in 1..<bounds.count {
    let a = bounds[j - 1], b = bounds[j]
    var ids: [CMPersistentTrackID] = []
    for s in segs where s.startFrame < b && s.endFrame > a { ids.append(s.trackID) }
    for o in overlays where o.startFrame < b && o.endFrame > a { ids.append(o.trackID) }
    var end = tl(b)
    if j == bounds.count - 1, CMTimeCompare(comp.duration, end) > 0 { end = comp.duration }
    instructions.append(FCInstruction(CMTimeRange(start: tl(a), end: end), ids))
}

// MARK: - the compositor

let bgraAttrs: [String: any Sendable] = [
    kCVPixelBufferPixelFormatTypeKey as String: [NSNumber(value: kCVPixelFormatType_32BGRA)],
    kCVPixelBufferMetalCompatibilityKey as String: true,
    kCVPixelBufferIOSurfacePropertiesKey as String: [String: Int](),
]

final class Renderer {
    nonisolated(unsafe) static var shared: Renderer!
    let segs: [SegPlan]
    let overlays: [OverlayPlan]
    let cues: [CuePlan]
    let totalFrames: Int
    let fadeInFrames: Double
    let fadeOutFrames: Double
    let ctx: CIContext
    let black: CIImage
    let lock = NSLock()
    var lastFrame: [CMPersistentTrackID: CVPixelBuffer] = [:]
    var missing = 0
    var rendered = 0

    init(segs: [SegPlan], overlays: [OverlayPlan], cues: [CuePlan], totalFrames: Int, fadeIn: Double, fadeOut: Double) {
        self.segs = segs
        self.overlays = overlays
        self.cues = cues
        self.totalFrames = totalFrames
        fadeInFrames = max(0, fadeIn * fpsD)
        fadeOutFrames = max(0, fadeOut * fpsD)
        guard let dev = MTLCreateSystemDefaultDevice() else { fail("no Metal device") }
        ctx = CIContext(mtlDevice: dev, options: [
            .workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false, .name: "finalcut",
        ])
        black = CIImage(color: CIColor(red: 0, green: 0, blue: 0)).cropped(to: designRect)
    }

    func frame(_ req: AVAsynchronousVideoCompositionRequest, _ id: CMPersistentTrackID, _ k: Int) -> CVPixelBuffer? {
        lock.lock(); defer { lock.unlock() }
        if let b = req.sourceFrame(byTrackID: id) {
            lastFrame[id] = b
            return b
        }
        missing += 1
        if missing <= 5 { warn("no source frame on track \(id) at frame \(k) (\(String(format: "%.3f", Double(k) / fpsD)) s); holding the last one") }
        return lastFrame[id]
    }

    /// A segment's frame at output frame k: oriented, blurred where asked, filled to the output
    /// size and zoomed. Extent = designRect.
    func segmentImage(_ s: SegPlan, _ buf: CVPixelBuffer, _ k: Int) -> CIImage {
        var img = orient(CIImage(cvPixelBuffer: buf), s.src)
        let local = k - s.startFrame
        let srcH = img.extent.height
        for b in s.blurs where local >= b.fromFrame && local < b.toFrame {
            let rc = CGRect(x: b.rect.minX, y: srcH - b.rect.maxY, width: b.rect.width, height: b.rect.height)
            let feather = 6.0
            let reach = b.sigma * 3 + feather * 2
            let region = rc.insetBy(dx: -reach, dy: -reach).intersection(img.extent)
            let blurred = img.cropped(to: region).clampedToExtent().applyingGaussianBlur(sigma: b.sigma)
                .cropped(to: rc.insetBy(dx: -feather * 2, dy: -feather * 2))
            let mask = CIImage(color: CIColor(red: 1, green: 1, blue: 1)).cropped(to: rc.insetBy(dx: -feather * 0.6, dy: -feather * 0.6))
                .applyingGaussianBlur(sigma: feather * 0.4).cropped(to: rc.insetBy(dx: -feather * 2, dy: -feather * 2))
            img = blurred.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: img, kCIInputMaskImageKey: mask])
                .cropped(to: CGRect(origin: .zero, size: s.src.oriented))
        }
        // Fill the output frame (identity for 1920x1080 clips).
        let ow = s.src.oriented.width, oh = s.src.oriented.height
        if abs(ow - designW) > 0.5 || abs(oh - designH) > 0.5 {
            let f = max(designW / ow, designH / oh)
            img = img.clampedToExtent().transformed(by: CGAffineTransform(scaleX: f, y: f), highQualityDownsample: f < 1)
                .transformed(by: CGAffineTransform(translationX: -(ow * f - designW) / 2, y: -(oh * f - designH) / 2))
                .cropped(to: designRect)
        }
        if let z = s.zoom {
            let u = s.durFrames > 1 ? Double(local) / Double(s.durFrames - 1) : 1
            let e = ease(z.ease, u)
            let sc = z.s0 + (z.s1 - z.s0) * e
            if sc > 1.0001 {
                let cx = (z.cx0 + (z.cx1 - z.cx0) * e) * designW
                let cyDown = (z.cy0 + (z.cy1 - z.cy0) * e) * designH
                let ww = designW / sc, wh = designH / sc
                let x0 = clamp(cx - ww / 2, 0, designW - ww)
                let y0 = clamp((designH - cyDown) - wh / 2, 0, designH - wh)
                img = img.clampedToExtent()
                    .transformed(by: CGAffineTransform(translationX: -x0, y: -y0).concatenating(CGAffineTransform(scaleX: sc, y: sc)))
            }
        }
        return img.cropped(to: designRect)
    }

    func alpha(_ img: CIImage, _ a: Double) -> CIImage {
        if a >= 0.999 { return img }
        return img.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: CGFloat(max(0, a)))])
    }

    func brightness(_ img: CIImage, _ f: Double) -> CIImage {
        if f >= 0.999 { return img }
        let v = CGFloat(max(0, f))
        return img.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: v, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: v, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: v, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
        ])
    }

    func render(_ req: AVAsynchronousVideoCompositionRequest) {
        let k = Int((req.compositionTime.seconds * fpsD).rounded())
        var out = black
        // Segments: one, or two during a transition (older first).
        let active = segs.filter { k >= $0.startFrame && k < $0.endFrame }
        var imgs: [CIImage] = []
        for s in active {
            if let b = frame(req, s.trackID, k) { imgs.append(segmentImage(s, b, k)) } else { imgs.append(black) }
        }
        if imgs.count == 1 {
            out = imgs[0]
        } else if imgs.count >= 2, let newer = active.last {
            let j = k - newer.startFrame
            let p = Double(j + 1) / Double(newer.overlap + 1)
            if newer.transition == "dip" {
                out = p < 0.5 ? brightness(imgs[imgs.count - 2], 1 - 2 * p) : brightness(imgs[imgs.count - 1], 2 * p - 1)
            } else {
                out = alpha(imgs[imgs.count - 1], p).composited(over: imgs[imgs.count - 2])
            }
        }
        // Picture-in-picture.
        for o in overlays where k >= o.startFrame && k < o.endFrame {
            guard let b = frame(req, o.trackID, k) else { continue }
            var v = orient(CIImage(cvPixelBuffer: b), o.src)
            if let s = o.srcRect {
                let r = CGRect(x: v.extent.minX + s.minX, y: v.extent.minY + v.extent.height - s.minY - s.height, width: s.width, height: s.height)
                v = v.cropped(to: r).transformed(by: CGAffineTransform(translationX: -r.minX, y: -r.minY))
            }
            let w = o.rect.width, h = o.rect.height
            let f = max(w / v.extent.width, h / v.extent.height)
            let scaled: CIImage
            if f > 1.0001 {
                // Upscaling (a magnifier): Lanczos keeps edges and text crisper than bilinear.
                scaled = v.clampedToExtent().applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: f, kCIInputAspectRatioKey: 1.0])
            } else {
                scaled = v.clampedToExtent().transformed(by: CGAffineTransform(scaleX: f, y: f), highQualityDownsample: f < 1)
            }
            var pip = scaled
                .transformed(by: CGAffineTransform(translationX: -((v.extent.width * f - w) / 2), y: -((v.extent.height * f - h) / 2)))
                .cropped(to: CGRect(x: 0, y: 0, width: w, height: h))
            pip = pip.applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: o.mask!])
            var group = o.rim.composited(over: pip).composited(over: o.shadow)
            if let l = o.label { group = l.composited(over: group) }
            var a = 1.0
            if o.fadeFrames > 0 {
                a = min(1, Double(k - o.startFrame + 1) / o.fadeFrames, Double(o.endFrame - k) / o.fadeFrames)
            }
            let e = smooth(a)
            let sc = 0.96 + 0.04 * e
            let cxUp = o.rect.midX, cyUp = designH - o.rect.midY
            var t = CGAffineTransform(translationX: -w / 2, y: -h / 2)
            if sc < 0.9999 { t = t.concatenating(CGAffineTransform(scaleX: sc, y: sc)) }
            t = t.concatenating(CGAffineTransform(translationX: cxUp, y: cyUp))
            out = alpha(group.transformed(by: t), e).composited(over: out)
        }
        // Subtitles.
        if burnSubs {
            for c in cues where k >= c.startFrame && k < c.endFrame {
                let a = min(1, c.fadeIn ? Double(k - c.startFrame + 1) / 4 : 1, c.fadeOut ? Double(c.endFrame - k) / 4 : 1)
                out = alpha(c.image, a).composited(over: out)
            }
        }
        // Fade from / to black.
        var fade = 1.0
        if fadeInFrames > 0 { fade = min(fade, Double(k) / fadeInFrames) }
        if fadeOutFrames > 0 { fade = min(fade, Double(totalFrames - 1 - k) / fadeOutFrames) }
        if fade < 1 { out = brightness(out, smooth(fade)) }
        out = out.composited(over: black).cropped(to: designRect)
        if renderScale != 1 {
            out = out.transformed(by: CGAffineTransform(scaleX: renderScale, y: renderScale), highQualityDownsample: true)
        }
        guard let pb = req.renderContext.newPixelBuffer() else {
            req.finish(with: NSError(domain: "finalcut", code: 1, userInfo: [NSLocalizedDescriptionKey: "no output buffer"]))
            return
        }
        CVBufferSetAttachment(pb, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(pb, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(pb, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
        ctx.render(out, to: pb, bounds: CGRect(x: 0, y: 0, width: renderW, height: renderH), colorSpace: nil)
        req.finish(withComposedVideoFrame: pb)
    }
}

final class FCCompositor: NSObject, AVVideoCompositing {
    private let queue = DispatchQueue(label: "finalcut.compositor", qos: .userInitiated)
    let sourcePixelBufferAttributes: [String: any Sendable]? = bgraAttrs
    let requiredPixelBufferAttributesForRenderContext: [String: any Sendable] = bgraAttrs
    func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}
    func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
        queue.async { autoreleasepool { Renderer.shared.render(request) } }
    }
    func cancelAllPendingVideoCompositionRequests() {
        queue.sync {}
    }
}

Renderer.shared = Renderer(segs: segs, overlays: overlays, cues: cues, totalFrames: totalFrames, fadeIn: edl.fadeIn ?? 0, fadeOut: edl.fadeOut ?? 0)

let vc = AVMutableVideoComposition()
vc.customVideoCompositorClass = FCCompositor.self
vc.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
vc.renderSize = CGSize(width: renderW, height: renderH)
vc.instructions = instructions
vc.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
vc.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
vc.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2

// MARK: - audio: decode + mix in memory

struct PCM {
    let data: [Float]
    let channels: Int
    var frames: Int { data.count / channels }
}

func loadPCM(_ path: String) async -> PCM {
    let url = resolve(path)
    guard FileManager.default.fileExists(atPath: url.path) else { fail("missing audio \(url.path)") }
    let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    guard let track = try? await asset.loadTracks(withMediaType: .audio).first else { fail("\(path): no audio track") }
    var ch = 1
    if let fds = try? await track.load(.formatDescriptions), let fd = fds.first,
       let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fd)?.pointee {
        ch = Int(asbd.mChannelsPerFrame)
    }
    ch = min(max(ch, 1), 2)
    guard let reader = try? AVAssetReader(asset: asset) else { fail("\(path): cannot read") }
    let out = AVAssetReaderTrackOutput(track: track, outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: audioRate, AVNumberOfChannelsKey: ch,
        AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
    ])
    reader.add(out)
    reader.startReading()
    var data: [Float] = []
    while let sb = out.copyNextSampleBuffer() {
        guard let bb = CMSampleBufferGetDataBuffer(sb) else { continue }
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        let at = Int((pts.seconds * Double(audioRate)).rounded()) * ch
        let n = CMBlockBufferGetDataLength(bb) / 4
        if at > data.count { data.append(contentsOf: [Float](repeating: 0, count: at - data.count)) }
        var chunk = [Float](repeating: 0, count: n)
        chunk.withUnsafeMutableBytes { _ = CMBlockBufferCopyDataBytes(bb, atOffset: 0, dataLength: n * 4, destination: $0.baseAddress!) }
        if at < data.count {
            let overlap = min(data.count - at, n)
            for i in 0..<overlap { data[at + i] = chunk[i] }
            if n > overlap { data.append(contentsOf: chunk[overlap...]) }
        } else {
            data.append(contentsOf: chunk)
        }
    }
    if reader.status == .failed { fail("\(path): decode failed: \(String(describing: reader.error))") }
    return PCM(data: data, channels: ch)
}

let samplesPerFrame = Double(audioRate) / fpsD
let totalSamples = Int((Double(totalFrames) * samplesPerFrame).rounded())
var mix = [Float](repeating: 0, count: totalSamples * 2)
var pcmCache: [String: PCM] = [:]
for (i, a) in (edl.audio ?? []).enumerated() {
    if pcmCache[a.file] == nil { pcmCache[a.file] = await loadPCM(a.file) }
    let pcm = pcmCache[a.file]!
    let fileDur = Double(pcm.frames) / Double(audioRate)
    let inS = max(0, a.inPoint ?? 0)
    var outS = a.outPoint ?? fileDur
    if outS > fileDur + 1e-3 { warn("audio \(i): out \(outS) is past the end of \(a.file) (\(String(format: "%.3f", fileDur))); clipped"); outS = fileDur }
    guard outS > inS else { warn("audio \(i): empty, skipped"); continue }
    let n = Int(((outS - inS) * Double(audioRate)).rounded())
    let src0 = Int((inS * Double(audioRate)).rounded())
    let dst0 = Int((a.at * Double(audioRate)).rounded())
    if dst0 + n > totalSamples { warn("audio \(i): runs past the end of the video (\(String(format: "%.3f", a.at + outS - inS)) s > \(String(format: "%.3f", totalSeconds)) s); cut") }
    let gain = Float(a.gain ?? 1)
    let fi = Float(max(0, a.fadeIn ?? 0.01) * Double(audioRate))
    let fo = Float(max(0, a.fadeOut ?? 0.01) * Double(audioRate))
    pcm.data.withUnsafeBufferPointer { src in
        for j in 0..<n {
            let d = dst0 + j, s = src0 + j
            if d < 0 || d >= totalSamples || s >= pcm.frames { continue }
            var g = gain
            if fi > 0, Float(j) < fi { g *= Float(j) / fi }
            if fo > 0, Float(n - 1 - j) < fo { g *= Float(n - 1 - j) / fo }
            if pcm.channels == 1 {
                let v = src[s] * g * 0.70710678     // -3 dB pan law: centred mono keeps its loudness
                mix[2 * d] += v
                mix[2 * d + 1] += v
            } else {
                mix[2 * d] += src[2 * s] * g
                mix[2 * d + 1] += src[2 * s + 1] * g
            }
        }
    }
}
// Global fades on the audio too.
let afi = (edl.fadeIn ?? 0) * Double(audioRate)
let afo = (edl.fadeOut ?? 0) * Double(audioRate)
var peak: Float = 0
var clipped = 0
for d in 0..<totalSamples {
    var g: Float = 1
    if afi > 0, Double(d) < afi { g = Float(Double(d) / afi) }
    if afo > 0 { let r = Double(totalSamples - 1 - d); if r < afo { g = min(g, Float(max(0, r) / afo)) } }
    for c in 0..<2 {
        var v = mix[2 * d + c] * g
        if abs(v) > 1 { clipped += 1; v = max(-1, min(1, v)) }
        peak = max(peak, abs(v))
        mix[2 * d + c] = v
    }
}
if clipped > 0 { warn("audio clipped on \(clipped) samples; lower the gain") }
let peakDb = peak > 0 ? 20 * log10(Double(peak)) : -200

// MARK: - read, encode, write

let renderStart = Date()
try? FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try? FileManager.default.removeItem(at: outURL)

let reader: AVAssetReader
do { reader = try AVAssetReader(asset: comp) } catch { fail("reader: \(error)") }
reader.timeRange = CMTimeRange(start: tl(rangeStartFrame), end: tl(rangeEndFrame))
let videoTracks = [trackA, trackB] + overlays.map { compTracks[$0.trackID]! }
let vOut = AVAssetReaderVideoCompositionOutput(videoTracks: videoTracks, videoSettings: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
])
vOut.videoComposition = vc
vOut.alwaysCopiesSampleData = false
guard reader.canAdd(vOut) else { fail("reader cannot add the composition output") }
reader.add(vOut)

let writer: AVAssetWriter
do { writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4) } catch { fail("writer: \(error)") }
writer.shouldOptimizeForNetworkUse = true
let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: renderW,
    AVVideoHeightKey: renderH,
    AVVideoColorPropertiesKey: [
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
    ],
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitrate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalKey: fps * 2,
        AVVideoExpectedSourceFrameRateKey: fps,
        AVVideoAllowFrameReorderingKey: true,
    ],
])
vIn.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vIn, sourcePixelBufferAttributes: nil)
guard writer.canAdd(vIn) else { fail("writer cannot add video") }
writer.add(vIn)

var layout = AudioChannelLayout()
layout.mChannelLayoutTag = kAudioChannelLayoutTag_Stereo
let layoutData = Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
let aIn = AVAssetWriterInput(mediaType: .audio, outputSettings: [
    AVFormatIDKey: kAudioFormatMPEG4AAC,
    AVSampleRateKey: audioRate,
    AVNumberOfChannelsKey: 2,
    AVEncoderBitRateKey: 192_000,
    AVEncoderBitRateStrategyKey: AVAudioBitRateStrategy_Constant,
    AVChannelLayoutKey: layoutData,
])
aIn.expectsMediaDataInRealTime = false
guard writer.canAdd(aIn) else { fail("writer cannot add audio") }
writer.add(aIn)

var asbd = AudioStreamBasicDescription(mSampleRate: Float64(audioRate), mFormatID: kAudioFormatLinearPCM,
                                       mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
                                       mBytesPerPacket: 8, mFramesPerPacket: 1, mBytesPerFrame: 8, mChannelsPerFrame: 2,
                                       mBitsPerChannel: 32, mReserved: 0)
var pcmFormat: CMAudioFormatDescription?
CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: MemoryLayout<AudioChannelLayout>.size, layout: &layout,
                               magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &pcmFormat)
guard let pcmFormat else { fail("cannot describe the PCM format") }

let audioStart = Int((Double(rangeStartFrame) * samplesPerFrame).rounded())
let audioEnd = Int((Double(rangeEndFrame) * samplesPerFrame).rounded())

func audioBuffer(_ from: Int, _ count: Int) -> CMSampleBuffer? {
    var block: CMBlockBuffer?
    let bytes = count * 8
    guard CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: bytes, blockAllocator: nil, customBlockSource: nil,
                                             offsetToData: 0, dataLength: bytes, flags: kCMBlockBufferAssureMemoryNowFlag,
                                             blockBufferOut: &block) == noErr, let block else { return nil }
    let st = mix.withUnsafeBytes { raw in
        CMBlockBufferReplaceDataBytes(with: raw.baseAddress!.advanced(by: from * 8), blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes)
    }
    guard st == noErr else { return nil }
    var sb: CMSampleBuffer?
    CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block, formatDescription: pcmFormat, sampleCount: count,
                                                         presentationTimeStamp: CMTime(value: CMTimeValue(from - audioStart), timescale: CMTimeScale(audioRate)),
                                                         packetDescriptions: nil, sampleBufferOut: &sb)
    return sb
}

guard reader.startReading() else { fail("reader failed to start: \(String(describing: reader.error))") }
guard writer.startWriting() else { fail("writer failed to start: \(String(describing: writer.error))") }
writer.startSession(atSourceTime: .zero)

final class Progress: @unchecked Sendable {
    var written = 0
    var videoDone = false
    var audioDone = false
    var audioCursor = 0
    var error: String?
}
let progress = Progress()
let group = DispatchGroup()
let vQueue = DispatchQueue(label: "finalcut.video")
let aQueue = DispatchQueue(label: "finalcut.audio")

group.enter()
vIn.requestMediaDataWhenReady(on: vQueue) {
    if progress.videoDone { return }
    while vIn.isReadyForMoreMediaData {
        guard let sb = vOut.copyNextSampleBuffer() else {
            if reader.status == .failed { progress.error = "reader failed: \(String(describing: reader.error))" }
            progress.videoDone = true
            vIn.markAsFinished()
            group.leave()
            return
        }
        guard let px = CMSampleBufferGetImageBuffer(sb) else { continue }
        let t = CMTime(value: CMTimeValue(progress.written), timescale: CMTimeScale(fps))
        if !adaptor.append(px, withPresentationTime: t) {
            progress.error = "video append failed at frame \(progress.written): \(String(describing: writer.error))"
            progress.videoDone = true
            vIn.markAsFinished()
            reader.cancelReading()
            group.leave()
            return
        }
        progress.written += 1
        if progress.written % 300 == 0 {
            let el = Date().timeIntervalSince(renderStart)
            note(String(format: "  %d / %d frames (%.0f fps)", progress.written, renderFrames, Double(progress.written) / el))
        }
    }
}

progress.audioCursor = audioStart
group.enter()
aIn.requestMediaDataWhenReady(on: aQueue) {
    if progress.audioDone { return }
    while aIn.isReadyForMoreMediaData {
        if progress.audioCursor >= audioEnd {
            progress.audioDone = true
            aIn.markAsFinished()
            group.leave()
            return
        }
        let n = min(4096, audioEnd - progress.audioCursor)
        guard let sb = audioBuffer(progress.audioCursor, n), aIn.append(sb) else {
            progress.error = "audio append failed: \(String(describing: writer.error))"
            progress.audioDone = true
            aIn.markAsFinished()
            group.leave()
            return
        }
        progress.audioCursor += n
    }
}

await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in group.notify(queue: .global()) { c.resume() } }
if let e = progress.error { writer.cancelWriting(); fail(e) }
writer.endSession(atSourceTime: tl(renderFrames))
await writer.finishWriting()
if writer.status != .completed { fail("writer failed: \(String(describing: writer.error))") }
// shouldOptimizeForNetworkUse leaves its unoptimized intermediate behind as <out>.sb-XXXX: remove it.
if let names = try? FileManager.default.contentsOfDirectory(atPath: outURL.deletingLastPathComponent().path) {
    for n in names where n.hasPrefix(outURL.lastPathComponent + ".sb-") {
        try? FileManager.default.removeItem(at: outURL.deletingLastPathComponent().appendingPathComponent(n))
    }
}
let elapsed = Date().timeIntervalSince(renderStart)
if progress.written != renderFrames { warn("wrote \(progress.written) frames, expected \(renderFrames)") }

// MARK: - --frames

var framePaths: [String] = []
if let fl = framesOpt {
    let dir = framesDirOpt.map { URL(fileURLWithPath: $0, isDirectory: true, relativeTo: cwd).standardizedFileURL } ?? outURL.deletingLastPathComponent()
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let gen = AVAssetImageGenerator(asset: AVURLAsset(url: outURL))
    gen.requestedTimeToleranceBefore = .zero
    gen.requestedTimeToleranceAfter = .zero
    gen.appliesPreferredTrackTransform = true
    for t in fl.split(separator: ",").compactMap({ Double($0.trimmingCharacters(in: .whitespaces)) }) {
        let local = t - rangeStartSec
        guard local >= 0, local < Double(renderFrames) / fpsD else { warn("--frames \(t) is outside the rendered range"); continue }
        do {
            let (img, _) = try await gen.image(at: CMTime(seconds: local + 1e-4, preferredTimescale: 600_000))
            let url = dir.appendingPathComponent(String(format: "t%.2f.png", t))
            guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { fail("cannot write \(url.path)") }
            CGImageDestinationAddImage(dest, img, nil)
            CGImageDestinationFinalize(dest)
            framePaths.append(url.path)
        } catch {
            warn("frame at \(t): \(error)")
        }
    }
}

let result: [String: Any] = [
    "out": outURL.path,
    "srt": srtURL.path,
    "sidecarSrt": sidecarSRT?.path ?? NSNull(),
    "width": renderW,
    "height": renderH,
    "fps": fps,
    "timelineDuration": r3(totalSeconds),
    "rendered": ["start": r3(rangeStartSec), "end": r3(Double(rangeEndFrame) / fpsD), "frames": progress.written],
    "renderSeconds": r3(elapsed),
    "speedX": r3(Double(progress.written) / fpsD / max(elapsed, 0.001)),
    "segments": segs.count,
    "overlays": overlays.count,
    "subtitles": cues.count,
    "burnedSubtitles": burnSubs,
    "audioPeakDb": r3(peakDb),
    "missingSourceFrames": Renderer.shared.missing,
    "warnings": Warnings.list,
    "frames": framePaths,
]
let json = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
print(String(data: json, encoding: .utf8)!)
