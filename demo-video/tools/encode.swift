// Frame-sequence -> constant-frame-rate H.264 MP4, plus probing and frame extraction, using only
// macOS AVFoundation (no ffmpeg). Build once:  swiftc -O encode.swift -o bin/encode
//
//   encode encode <framesDir> <out.mp4> [--fps 30] [--bitrate 16000000] [--width 1920 --height 1080]
//       framesDir/manifest.json = { "duration": s, "frames": [["000001.jpg", t], ...] } with t in
//       seconds from the clip start. Output frame k shows the newest captured frame at or before
//       k/fps (+ half a frame), so frames are duplicated or dropped and motion keeps real speed.
//   encode probe <file.mp4>                       JSON: duration, fps, counted frames, size, codec
//   encode frames <file.mp4> <outPrefix> <t1,t2,...>   PNGs at those seconds: <outPrefix>-<t>s.png
import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

func opt(_ args: [String], _ name: String) -> String? {
    if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }
    return nil
}

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else {
    fail("usage: encode encode|probe|frames ...")
}

// MARK: - encode

func loadImage(_ url: URL) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
}

func encode(_ args: [String]) {
    guard args.count >= 3 else { fail("usage: encode encode <framesDir> <out.mp4> [--fps 30] [--bitrate N]") }
    let dir = URL(fileURLWithPath: args[1])
    let out = URL(fileURLWithPath: args[2])
    let fps = Int32(opt(args, "--fps") ?? "30") ?? 30
    let bitrate = Int(opt(args, "--bitrate") ?? "16000000") ?? 16_000_000
    let width = Int(opt(args, "--width") ?? "1920") ?? 1920
    let height = Int(opt(args, "--height") ?? "1080") ?? 1080

    guard let data = try? Data(contentsOf: dir.appendingPathComponent("manifest.json")),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let rawFrames = json["frames"] as? [[Any]]
    else { fail("cannot read \(dir.path)/manifest.json") }
    var frames: [(String, Double)] = rawFrames.compactMap { f in
        guard f.count >= 2, let name = f[0] as? String else { return nil }
        let t = (f[1] as? Double) ?? Double(f[1] as? Int ?? 0)
        return (name, t)
    }
    frames.sort { $0.1 < $1.1 }
    guard !frames.isEmpty else { fail("no frames in manifest") }
    let duration = (json["duration"] as? Double) ?? (frames.last!.1 + 1.0 / Double(fps))
    let total = max(1, Int((duration * Double(fps)).rounded()))

    try? FileManager.default.removeItem(at: out)
    let writer: AVAssetWriter
    do { writer = try AVAssetWriter(outputURL: out, fileType: .mp4) } catch { fail("writer: \(error)") }
    let settings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
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
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: input,
        sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
        ])
    writer.add(input)
    guard writer.startWriting() else { fail("startWriting: \(String(describing: writer.error))") }
    writer.startSession(atSourceTime: .zero)

    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    func makeBuffer(_ img: CGImage) -> CVPixelBuffer? {
        var pb: CVPixelBuffer?
        if let pool = adaptor.pixelBufferPool {
            CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
        } else {
            CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32BGRA, nil, &pb)
        }
        guard let buf = pb else { return nil }
        CVBufferSetAttachment(buf, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buf, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buf, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
        CVPixelBufferLockBaseAddress(buf, [])
        defer { CVPixelBufferUnlockBaseAddress(buf, []) }
        guard let ctx = CGContext(
            data: CVPixelBufferGetBaseAddress(buf), width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return nil }
        ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        ctx.interpolationQuality = .high
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: width, height: height))
        return buf
    }

    var idx = 0
    var shownIdx = -1
    var current: CVPixelBuffer?
    var unique = 0
    let half = 0.5 / Double(fps)
    for k in 0..<total {
        let t = Double(k) / Double(fps)
        while idx + 1 < frames.count && frames[idx + 1].1 <= t + half { idx += 1 }
        if idx != shownIdx || current == nil {
            autoreleasepool {
                if let img = loadImage(dir.appendingPathComponent(frames[idx].0)), let b = makeBuffer(img) {
                    current = b
                    unique += 1
                } else {
                    FileHandle.standardError.write("warning: could not decode \(frames[idx].0)\n".data(using: .utf8)!)
                }
            }
            shownIdx = idx
        }
        guard let buf = current else { continue }
        while !input.isReadyForMoreMediaData { usleep(2000) }
        if !adaptor.append(buf, withPresentationTime: CMTime(value: CMTimeValue(k), timescale: fps)) {
            fail("append failed at frame \(k): \(String(describing: writer.error))")
        }
    }
    input.markAsFinished()
    let sem = DispatchSemaphore(value: 0)
    writer.finishWriting { sem.signal() }
    sem.wait()
    if writer.status != .completed { fail("finish: \(String(describing: writer.error))") }
    print("{\"out\":\"\(out.path)\",\"frames\":\(total),\"fps\":\(fps),\"duration\":\(Double(total) / Double(fps)),\"sourceFrames\":\(frames.count),\"uniqueShown\":\(unique)}")
}

// MARK: - probe

func probe(_ args: [String]) {
    guard args.count >= 2 else { fail("usage: encode probe <file.mp4>") }
    let url = URL(fileURLWithPath: args[1])
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else { fail("no video track in \(url.path)") }
    guard let reader = try? AVAssetReader(asset: asset) else { fail("cannot read \(url.path)") }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    reader.add(output)
    reader.startReading()
    var count = 0
    var keyframes = 0
    while let sb = output.copyNextSampleBuffer() {
        let n = CMSampleBufferGetNumSamples(sb)
        count += n
        if let att = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[CFString: Any]],
           let first = att.first, (first[kCMSampleAttachmentKey_NotSync] as? Bool) != true {
            keyframes += 1
        } else if CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) == nil {
            keyframes += 1
        }
    }
    var codec = "?"
    if let fd = track.formatDescriptions.first {
        let sub = CMFormatDescriptionGetMediaSubType(fd as! CMFormatDescription)
        codec = String(bytes: [UInt8((sub >> 24) & 0xff), UInt8((sub >> 16) & 0xff), UInt8((sub >> 8) & 0xff), UInt8(sub & 0xff)], encoding: .ascii) ?? "?"
    }
    let size = track.naturalSize
    let attrs = (try? FileManager.default.attributesOfItem(atPath: url.path)) ?? [:]
    let bytes = (attrs[.size] as? NSNumber)?.intValue ?? 0
    print("{\"file\":\"\(url.lastPathComponent)\",\"duration\":\(String(format: "%.3f", CMTimeGetSeconds(asset.duration))),\"fps\":\(String(format: "%.3f", track.nominalFrameRate)),\"frames\":\(count),\"keyframes\":\(keyframes),\"width\":\(Int(size.width)),\"height\":\(Int(size.height)),\"codec\":\"\(codec)\",\"audioTracks\":\(asset.tracks(withMediaType: .audio).count),\"bytes\":\(bytes),\"readerStatus\":\(reader.status.rawValue)}")
}

// MARK: - frames

func extractFrames(_ args: [String]) {
    guard args.count >= 4 else { fail("usage: encode frames <file.mp4> <outPrefix> <t1,t2,...>") }
    let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
    let gen = AVAssetImageGenerator(asset: asset)
    gen.requestedTimeToleranceBefore = .zero
    gen.requestedTimeToleranceAfter = .zero
    gen.appliesPreferredTrackTransform = true
    let times = args[3].split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    for t in times {
        var actual = CMTime.zero
        do {
            let img = try gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: &actual)
            let path = "\(args[2])-\(String(format: "%05.2f", t))s.png"
            guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil) else { fail("cannot write \(path)") }
            CGImageDestinationAddImage(dest, img, nil)
            CGImageDestinationFinalize(dest)
            print("\(path) (actual \(String(format: "%.3f", CMTimeGetSeconds(actual)))s, \(img.width)x\(img.height))")
        } catch {
            fail("frame at \(t)s: \(error)")
        }
    }
}

switch cmd {
case "encode": encode(args)
case "probe": probe(args)
case "frames": extractFrames(args)
default: fail("unknown command \(cmd)")
}
