// 3D 个人主页 — Vite + Three.js
// 之后会替换为更复杂的 3D 场景 (R3F + 物理 + 资源)

import * as THREE from 'three'

// ---------- Scene ----------
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0a0a0f)
scene.fog = new THREE.Fog(0x0a0a0f, 6, 14)

// ---------- Camera ----------
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  100
)
camera.position.set(0, 0, 5)

// ---------- Renderer ----------
const canvas = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)

// ---------- Geometry: 二十面体 ----------
const geometry = new THREE.IcosahedronGeometry(1.4, 0)
const material = new THREE.MeshStandardMaterial({
  color: 0x6366f1,
  metalness: 0.7,
  roughness: 0.2,
  emissive: 0x4f46e5,
  emissiveIntensity: 0.15,
  flatShading: true,
})
const mesh = new THREE.Mesh(geometry, material)
scene.add(mesh)

// Wireframe overlay
const wireframe = new THREE.LineSegments(
  new THREE.EdgesGeometry(geometry),
  new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.25,
  })
)
mesh.add(wireframe)

// ---------- Lights ----------
scene.add(new THREE.AmbientLight(0xffffff, 0.35))

const light1 = new THREE.PointLight(0x6366f1, 80, 12)
light1.position.set(3, 2, 3)
scene.add(light1)

const light2 = new THREE.PointLight(0xec4899, 60, 12)
light2.position.set(-3, -1, 2)
scene.add(light2)

const light3 = new THREE.PointLight(0x06b6d4, 50, 12)
light3.position.set(0, -3, -2)
scene.add(light3)

// ---------- Interaction ----------
let isDragging = false
let lastPointer = { x: 0, y: 0 }
const targetRot = { x: 0, y: 0 }
const currentRot = { x: 0, y: 0 }

function onDown(x, y) {
  isDragging = true
  lastPointer = { x, y }
}
function onMove(x, y) {
  if (!isDragging) return
  const dx = x - lastPointer.x
  const dy = y - lastPointer.y
  targetRot.y += dx * 0.005
  targetRot.x += dy * 0.005
  lastPointer = { x, y }
}
function onUp() {
  isDragging = false
}

// Mouse
canvas.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY))
window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY))
window.addEventListener('mouseup', onUp)

// Touch
canvas.addEventListener('touchstart', (e) => {
  if (e.touches[0]) onDown(e.touches[0].clientX, e.touches[0].clientY)
})
window.addEventListener('touchmove', (e) => {
  if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY)
})
window.addEventListener('touchend', onUp)

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// ---------- Animation Loop ----------
const clock = new THREE.Clock()
function animate() {
  const t = clock.getElapsedTime()

  if (!isDragging) {
    targetRot.y += 0.0035
  }
  // Smooth interpolation
  currentRot.x += (targetRot.x - currentRot.x) * 0.1
  currentRot.y += (targetRot.y - currentRot.y) * 0.1

  mesh.rotation.x = currentRot.x
  mesh.rotation.y = currentRot.y
  mesh.position.y = Math.sin(t * 0.7) * 0.15

  // Animate point lights in orbits
  light1.position.x = Math.cos(t * 0.6) * 3.5
  light1.position.z = Math.sin(t * 0.6) * 3.5
  light2.position.x = Math.cos(t * 0.4 + Math.PI) * 3.5
  light2.position.z = Math.sin(t * 0.4 + Math.PI) * 3.5

  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()
