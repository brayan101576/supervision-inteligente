import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert } from 'react-native';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';

export default function HomeScreen() {
  const [hasPermission, setHasPermission] = useState(null);
  const [location, setLocation] = useState(null);

  useEffect(() => {
    (async () => {
      // Pedimos los permisos al abrir la pantalla
      const cameraStatus = await Camera.requestCameraPermissionsAsync();
      const locationStatus = await Location.requestForegroundPermissionsAsync();
      
      setHasPermission(cameraStatus.status === 'granted' && locationStatus.status === 'granted');

      if (locationStatus.status === 'granted') {
        const currentLocation = await Location.getCurrentPositionAsync({});
        setLocation(currentLocation.coords);
      }
    })();
  }, []);

  const registrarVisita = () => {
    if (!location) {
      Alert.alert("Error", "Buscando señal GPS. Intenta en unos segundos.");
      return;
    }
    Alert.alert("Éxito", `Coordenadas capturadas: \nLat: ${location.latitude}\nLon: ${location.longitude}`);
  };

  if (hasPermission === null) return <View style={styles.container}><Text>Pidiendo permisos...</Text></View>;
  if (hasPermission === false) return <View style={styles.container}><Text>Sin acceso a cámara o GPS</Text></View>;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Nuevo Reporte de Supervisión</Text>
        <Text style={styles.subtitle}>
          Ubicación: {location ? "GPS Activo 🟢" : "Buscando GPS 🔴"}
        </Text>

        <TouchableOpacity style={styles.button} onPress={registrarVisita}>
          <Text style={styles.buttonText}>Registrar Visita (Check-in)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20, justifyContent: 'center' },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 10, elevation: 3 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  subtitle: { fontSize: 14, color: 'gray', marginBottom: 20 },
  button: { backgroundColor: '#007bff', padding: 15, borderRadius: 5, alignItems: 'center' },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 }
});