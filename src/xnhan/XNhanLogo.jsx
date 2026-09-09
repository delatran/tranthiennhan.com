const XNHAN_AVATAR_32 = "/assets/portrait-icon-20d683e7-32.png";
const XNHAN_AVATAR_192 = "/assets/portrait-icon-20d683e7-192.png";

export function XNhanAvatar({ className = "xnhan-logo-avatar" } = {}) {
  return (
    <img
      className={className}
      src={XNHAN_AVATAR_192}
      srcSet={`${XNHAN_AVATAR_32} 32w, ${XNHAN_AVATAR_192} 192w`}
      sizes="32px"
      width="192"
      height="192"
      alt=""
      decoding="async"
    />
  );
}

export function XNhanLogo() {
  return (
    <>
      <XNhanAvatar />
      <span className="xnhan-logo-name" aria-hidden="true">
        X Nhân
      </span>
    </>
  );
}
