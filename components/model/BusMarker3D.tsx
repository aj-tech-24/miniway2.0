import { GLView } from "expo-gl";
import React from "react";
import { StyleSheet, View } from "react-native";
import * as THREE from "three";

interface BusMarker3DProps {
  size?: number;
  color?: string;
}

export function BusMarker3D({
  size = 40,
  color = "#007AFF",
}: BusMarker3DProps) {
  const onContextCreate = async (gl: any) => {
    const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);

    // Create a custom renderer using the GL context
    const renderer = new THREE.WebGLRenderer({
      canvas: gl.canvas,
      context: gl,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true, // Add this to prevent clearing
    });

    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0); // Transparent background
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // Limit pixel ratio for performance

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    // Create a bus-like 3D shape
    const busGroup = new THREE.Group();

    // Main bus body (elongated box)
    const bodyGeometry = new THREE.BoxGeometry(1.5, 0.8, 0.6);
    const bodyMaterial = new THREE.MeshLambertMaterial({
      color: color === "#28a745" ? 0x28a745 : 0xdc3545,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.set(0, 0, 0);
    busGroup.add(body);

    // Bus windows
    const windowGeometry = new THREE.BoxGeometry(0.05, 0.4, 0.3);
    const windowMaterial = new THREE.MeshLambertMaterial({ color: 0x87ceeb });

    // Front window
    const frontWindow = new THREE.Mesh(windowGeometry, windowMaterial);
    frontWindow.position.set(0.75, 0, 0);
    busGroup.add(frontWindow);

    // Side windows
    for (let i = 0; i < 2; i++) {
      const sideWindow = new THREE.Mesh(windowGeometry, windowMaterial);
      sideWindow.position.set(-0.3 + i * 0.6, 0, 0.35);
      sideWindow.rotation.y = Math.PI / 2;
      busGroup.add(sideWindow);
    }

    // Wheels
    const wheelGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8);
    const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });

    const wheel1 = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel1.position.set(-0.6, -0.5, 0.3);
    wheel1.rotation.z = Math.PI / 2;
    busGroup.add(wheel1);

    const wheel2 = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel2.position.set(0.6, -0.5, 0.3);
    wheel2.rotation.z = Math.PI / 2;
    busGroup.add(wheel2);

    const wheel3 = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel3.position.set(-0.6, -0.5, -0.3);
    wheel3.rotation.z = Math.PI / 2;
    busGroup.add(wheel3);

    const wheel4 = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel4.position.set(0.6, -0.5, -0.3);
    wheel4.rotation.z = Math.PI / 2;
    busGroup.add(wheel4);

    // Scale and position the bus
    busGroup.scale.set(0.6, 0.6, 0.6);
    busGroup.position.set(0, -0.3, 0);
    busGroup.rotation.y = Math.PI / 4;

    scene.add(busGroup);

    // Position camera closer to the model
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);

    // Animation loop with reduced rotation speed
    const animate = () => {
      requestAnimationFrame(animate);

      // Slower rotation for better performance
      busGroup.rotation.y += 0.005;

      renderer.render(scene, camera);
      gl.endFrameEXP();
    };

    animate();
  };

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <GLView
        style={[StyleSheet.absoluteFill, styles.glView]}
        onContextCreate={onContextCreate}
        msaaSamples={0}
        enableExperimentalWorkletSupport={false}
      />
      {/* Add a subtle shadow/pointer below the 3D model */}
      <View style={styles.shadow} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible", // Allow content to extend beyond bounds
  },
  glView: {
    overflow: "visible", // Ensure GL content is not clipped
  },
  shadow: {
    position: "absolute",
    bottom: -6,
    width: 10,
    height: 10,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderRadius: 5,
    transform: [{ scaleX: 1.2 }],
  },
});
