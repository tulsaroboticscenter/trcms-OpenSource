/**
 * Route wrapper for MemberEnrollments — reads memberId from URL params.
 * This exists so MemberEnrollments can also be used as an embedded panel
 * (with explicit props) without needing to read from the URL.
 */
import { useParams } from "react-router-dom";
import MemberEnrollments from "./MemberEnrollments";

export default function EnrollmentMemberPage() {
  const { memberId } = useParams<{ memberId: string }>();
  return <MemberEnrollments memberId={parseInt(memberId!)} />;
}
