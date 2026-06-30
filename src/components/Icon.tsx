interface IconProps {
  className?: string
  src: string
}

function Icon({ className = '', src }: IconProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`app-icon inline-block shrink-0 ${className}`}
      draggable={false}
      src={src}
    />
  )
}

export default Icon
