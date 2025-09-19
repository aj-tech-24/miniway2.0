import { OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import React, { Suspense } from "react";

function BusModel3D(props: any) {
  const gltf: any = useGLTF(require("../assets/models/bus.glb"));
  return <primitive object={gltf.scene} {...props} />;
}

export function Sample3d() {
  return (
    <Canvas camera={{ position: [0, 2, 5], fov: 50 }}>
      <color attach="background" args={["#222"]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 10, 5]} intensity={1.2} />

      <Suspense fallback={null}>
        <BusModel3D scale={1.0} />
      </Suspense>

      <OrbitControls />
    </Canvas>
  );
}

export default BusModel3D;
