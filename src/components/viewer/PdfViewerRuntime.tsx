import DocViewer, { PDFRenderer, type IConfig, type IDocument } from "@iamjariwala/react-doc-viewer"
import "@iamjariwala/react-doc-viewer/dist/index.css"

interface PdfViewerRuntimeProps {
  documents: IDocument[]
  config: IConfig
}

export default function PdfViewerRuntime({
  documents,
  config,
}: PdfViewerRuntimeProps) {
  return (
    <DocViewer
      className="rosetta-pdf-viewer"
      style={{ height: "100%", width: "100%" }}
      documents={documents}
      pluginRenderers={[PDFRenderer]}
      config={config}
      prefetchMethod="GET"
    />
  )
}
