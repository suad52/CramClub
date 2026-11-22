// Joins the shot clips into one MP4 with hard cuts, using only macOS AVFoundation (no ffmpeg).
// Build once:  swiftc -O -swift-version 5 assemble.swift -o bin/assemble
//
//   assemble <out.mp4> <clip1.mp4> <clip2.mp4@start-end> ... [--timeline timeline.json] [--bitrate 16000000]
//            [--passthrough]
//
// The clips are laid end to end on one AVMutableComposition video track (hard cuts, nothing
// trimmed). By default the composition is decoded and re-encoded with AVAssetWriter: H.264 High,
// 1920x1080, BT.709, 16 Mbit/s (the clips' own settings), every frame stamped k/30 s, so the
// result is one clean constant-30-fps segment that every player and editor reads the same way.
// --passthrough instead copies the H.264 samples through AVAssetExportSession (lossless and
// instant, but the file carries one edit-list entry per clip, which some players handle badly).
// --timeline writes where each clip starts and ends in the output (seconds), for the script.
import AVFoundation
import CoreVideo
import Foundation

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

/// Seconds rounded to milliseconds, as a decimal so the JSON reads 27.3, not 27.300000000000001.
func r3(_ x: Double) -> NSDecimalNumber { NSDecimalNumber(string: String(format: "%.3f", x)) }

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
let timelinePath = takeOpt("--timeline")
let bitrate = Int(takeOpt("--bitrate") ?? "16000000") ?? 16_000_000
let passthrough = takeFlag("--passthrough")
let fps: Int32 = 30

guard args.count >= 2 else {
    fail("usage: assemble <out.mp4> <clip1.mp4> <clip2.mp4> ... [--timeline t.json] [--bitrate N] [--passthrough]")
}
let outURL = URL(fileURLWithPath: args[0])
// A clip may be trimmed: "clip.mp4@12.5-18" uses only 12.5 s to 18 s of it (rounded to frames).
let clips: [(url: URL, trim: (Double, Double)?)] = args.dropFirst().map { arg in
    guard let at = arg.lastIndex(of: "@") else { return (URL(fileURLWithPath: arg), nil) }
    let parts = arg[arg.index(after: at)...].split(separator: "-").compactMap { Double($0) }
    guard parts.count == 2, parts[1] > parts[0] else { fail("bad trim in \(arg): use clip.mp4@start-end") }
    return (URL(fileURLWithPath: String(arg[..<at])), (parts[0], parts[1]))
}

// MARK: - composition

let comp = AVMutableComposition()
guard let vTrack = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
    fail("cannot add a video track")
}

var cursor = CMTime.zero
var timeline: [[String: Any]] = []
var size = CGSize.zero
var expectedFrames = 0

for (url, trim) in clips {
    let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    let tracks: [AVAssetTrack]
    do { tracks = try await asset.loadTracks(withMediaType: .video) } catch { fail("\(url.lastPathComponent): \(error)") }
    guard let src = tracks.first else { fail("\(url.lastPathComponent): no video track") }
    var range: CMTimeRange
    let natural: CGSize
    do {
        range = try await src.load(.timeRange)
        natural = try await src.load(.naturalSize)
    } catch { fail("\(url.lastPathComponent): \(error)") }
    if size == .zero { size = natural } else if natural != size {
        fail("\(url.lastPathComponent) is \(natural), the others are \(size)")
    }
    if let (a, b) = trim {
        let frame = { (t: Double) in CMTimeAdd(range.start, CMTime(value: CMTimeValue((t * Double(fps)).rounded()), timescale: fps)) }
        range = CMTimeRangeGetIntersection(range, otherRange: CMTimeRange(start: frame(a), end: frame(b)))
        if range.duration.seconds <= 0 { fail("\(url.lastPathComponent)@\(a)-\(b) is outside the clip") }
    }
    do { try vTrack.insertTimeRange(range, of: src, at: cursor) } catch { fail("\(url.lastPathComponent): insert: \(error)") }
    let start = cursor.seconds
    cursor = CMTimeAdd(cursor, range.duration)
    expectedFrames += Int((range.duration.seconds * Double(fps)).rounded())
    timeline.append([
        "file": url.lastPathComponent,
        "in": r3(trim?.0 ?? 0),
        "out": r3(trim?.1 ?? range.duration.seconds),
        "start": r3(start),
        "end": r3(cursor.seconds),
        "duration": r3(range.duration.seconds),
    ])
}

try? FileManager.default.removeItem(at: outURL)
var written = 0

if passthrough {
    guard let export = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough) else {
        fail("no passthrough export session")
    }
    export.shouldOptimizeForNetworkUse = true
    do { try await export.export(to: outURL, as: .mp4) } catch { fail("export failed: \(error)") }
    written = expectedFrames
} else {
    // MARK: - decode the composition, re-encode with fresh k/30 timestamps
    let reader: AVAssetReader
    do { reader = try AVAssetReader(asset: comp) } catch { fail("reader: \(error)") }
    let output = AVAssetReaderTrackOutput(track: vTrack, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
    ])
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { fail("reader cannot add the track output") }
    reader.add(output)

    let writer: AVAssetWriter
    do { writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4) } catch { fail("writer: \(error)") }
    writer.shouldOptimizeForNetworkUse = true
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: Int(size.width),
        AVVideoHeightKey: Int(size.height),
        AVVideoColorPropertiesKey: [
            AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
            AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
            AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: bitrate,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
            AVVideoExpectedSourceFrameRateKey: Int(fps),
            AVVideoAllowFrameReorderingKey: true,
        ],
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
    guard writer.canAdd(input) else { fail("writer cannot add the input") }
    writer.add(input)

    guard reader.startReading() else { fail("reader failed to start: \(String(describing: reader.error))") }
    guard writer.startWriting() else { fail("writer failed to start: \(String(describing: writer.error))") }
    writer.startSession(atSourceTime: .zero)

    while let sample = output.copyNextSampleBuffer() {
        guard let pixels = CMSampleBufferGetImageBuffer(sample) else { continue }
        while !input.isReadyForMoreMediaData { usleep(2000) }
        let t = CMTime(value: CMTimeValue(written), timescale: fps)
        if !adaptor.append(pixels, withPresentationTime: t) {
            fail("append failed at frame \(written): \(String(describing: writer.error))")
        }
        written += 1
        if written % 1500 == 0 {
            FileHandle.standardError.write("  \(written) / \(expectedFrames) frames\n".data(using: .utf8)!)
        }
    }
    if reader.status == .failed { fail("reader failed: \(String(describing: reader.error))") }
    input.markAsFinished()
    writer.endSession(atSourceTime: CMTime(value: CMTimeValue(written), timescale: fps))
    await writer.finishWriting()
    if writer.status != .completed { fail("writer failed: \(String(describing: writer.error))") }
}

let result: [String: Any] = [
    "out": outURL.path,
    "mode": passthrough ? "passthrough (no re-encode)" : "re-encoded H.264 \(bitrate / 1_000_000) Mbit/s, constant \(fps) fps",
    "clips": timeline.count,
    "duration": r3(cursor.seconds),
    "framesExpected": expectedFrames,
    "framesWritten": written,
    "timeline": timeline,
]
let json = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
if let p = timelinePath { try! json.write(to: URL(fileURLWithPath: p)) }
print(String(data: json, encoding: .utf8)!)
if written != expectedFrames { fail("frame count mismatch: wrote \(written), expected \(expectedFrames)") }
