import React, { useEffect, useRef } from 'react';

export default function MicWaveform({ isListening }) {
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (isListening) {
      startVisualizer();
    } else {
      stopVisualizer();
    }
    return () => stopVisualizer();
  }, [isListening]);

  const startVisualizer = async () => {
    try {
      // Request mic stream specifically for the visualizer
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      
      // Use a low FFT size for "chunky", distinct bars
      analyserRef.current.fftSize = 64; 

      const source = audioCtxRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      const draw = () => {
        animationRef.current = requestAnimationFrame(draw);
        analyserRef.current.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          // Normalize height against the canvas
          const barHeight = (dataArray[i] / 255) * canvas.height; 
          
          // Color it a dynamic Red/Orange based on volume height
          ctx.fillStyle = `rgb(244, ${60 + barHeight * 2}, 54)`; 
          ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
          x += barWidth + 1;
        }
      };

      draw();
    } catch (err) {
      console.error("Visualizer Error: Check Microphone Permissions", err);
    }
  };

  const stopVisualizer = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
    }
  };

  return (
    <canvas 
      ref={canvasRef} 
      width={80} 
      height={30} 
      style={{ display: 'block', margin: '0 auto', pointerEvents: 'none' }} 
    />
  );
}