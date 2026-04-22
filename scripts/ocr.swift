import Vision
import AppKit
import Foundation

guard CommandLine.arguments.count > 1 else {
    fputs("Usage: swift ocr.swift <image_path>\n", stderr)
    exit(1)
}

let imagePath = CommandLine.arguments[1]

guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
    fputs("Error: Cannot load image at \(imagePath)\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en"]
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
    try handler.perform([request])
} catch {
    fputs("Error: OCR failed - \(error.localizedDescription)\n", stderr)
    exit(1)
}

var results: [[String: Any]] = []

if let observations = request.results {
    let imageHeight = CGFloat(cgImage.height)

    for observation in observations {
        if let topCandidate = observation.topCandidates(1).first {
            let box = observation.boundingBox
            results.append([
                "text": topCandidate.string,
                "x": round(box.origin.x * 1000) / 1000,
                "y": round((1 - box.origin.y - box.height) * 1000) / 1000,
                "width": round(box.width * 1000) / 1000,
                "height": round(box.height * 1000) / 1000,
                "confidence": round(Double(observation.confidence) * 1000) / 1000
            ])
        }
    }
}

if let jsonData = try? JSONSerialization.data(withJSONObject: results, options: .prettyPrinted),
   let jsonString = String(data: jsonData, encoding: .utf8) {
    print(jsonString)
} else {
    print("[]")
}
