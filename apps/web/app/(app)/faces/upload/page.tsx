import { FaceUploadForm } from "../../../../components/face-upload-form";
import { PageHeader } from "../../../../components/ui";

export default function FaceUploadPage() {
  return (
    <>
      <PageHeader
        title="Add a face profile"
        description="Quality analysis runs in your browser before the private upload begins."
      />
      <FaceUploadForm />
    </>
  );
}
